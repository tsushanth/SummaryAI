/**
 * App-wide store for AI Coach sessions, following Android's ActiveCoachingSession. It lives as long as the tab, not as
 * long as any page: only the user (stop) or the server (the meeting ended, the bot failed or was not let in) ends a
 * session. Leaving a page or losing the connection does not, and after a reload attach() picks the session up again.
 * A stop the server has not acknowledged is remembered for the tab, so a reload does not undo it.
 * Unlike Android it keeps one state per meeting, so looking at an earlier meeting never hides or interrupts a running one.
 * Imports only ./api.ts, so the node tests load it directly.
 */
import type { CoachingApi, CoachingInsight, LatestSessionResponse } from './api.ts';

export type CoachingPhase = 'starting' | 'live' | 'reconnecting' | 'ended' | 'not_started';
export type StartFailure = 'no_credits' | 'meeting_over' | 'other';

export interface CoachingState {
  phase: CoachingPhase;
  /** Newest first, each tip once. */
  insights: CoachingInsight[];
  /** Server code for why the session ended (or why the bot is gone when it could not start). Null = unknown. */
  endReason: string | null;
  refunded: boolean;
  startFailure: StartFailure | null;
}

export const STOPPED_BY_USER = 'client';

const START_RETRY_MS = [2_000, 5_000];
const RECONNECT_MS = [2_000, 5_000, 10_000, 20_000, 30_000];
/** Consecutive failed reconnects after which the failure is reported (once per outage). */
const REPORT_AFTER_FAILURES = 5;
/** A connection counts as recovered only once it has held this long (the server's heartbeat interval). */
const STABLE_AFTER_MS = 20_000;
/** Consecutive refused streams, with the server also showing no such session, after which it is taken to be gone. */
const REFUSALS_BEFORE_GONE = 5;
const STOPS_KEY = 'mm_coach_stops';

export interface CoachSessionOptions {
  startRetryMs?: number[];
  reconnectMs?: number[];
  stableAfterMs?: number;
  onFailure?: (flow: 'coach_start' | 'coach_stream', status: number) => void;
  /** Where unacknowledged stops are kept across a reload (sessionStorage). It may throw; the store carries on. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

interface PendingStop {
  sessionId: string;
  recordingId: string;
}

interface Entry {
  recordingId: string;
  /** Set when this tab asked for the session, so a failed start can be repeated. */
  persona: string | null;
  sessionId: string | null;
  abort: AbortController;
  state: CoachingState;
}

const statusOf = (error: unknown): number => (error as { status?: number } | null)?.status ?? -1;
/** A repeat can help: no answer, or the server failed. */
const isTransient = (error: unknown) => statusOf(error) === 0 || statusOf(error) >= 500;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

function newestFirst(tips: CoachingInsight[]): CoachingInsight[] {
  const byId = new Map(tips.map((t) => [t.id, t]));
  return Array.from(byId.values()).sort((a, b) => b.emitted_at.localeCompare(a.emitted_at));
}

const fresh = (phase: CoachingPhase, insights: CoachingInsight[] = []): CoachingState => ({
  phase,
  insights,
  endReason: null,
  refunded: false,
  startFailure: null,
});

export function createCoachSession(api: CoachingApi, options: CoachSessionOptions = {}) {
  const startRetryMs = options.startRetryMs ?? START_RETRY_MS;
  const reconnectMs = options.reconnectMs ?? RECONNECT_MS;
  const stableAfterMs = options.stableAfterMs ?? STABLE_AFTER_MS;
  const backoff = (attempt: number) => reconnectMs[Math.min(attempt, reconnectMs.length - 1)]!;

  const meetings = new Map<string, Entry>();
  const attaching = new Map<string, AbortController>();
  /** Stops the server has not acknowledged yet, by session id. */
  const stops = new Map<string, { recordingId: string; abort: AbortController }>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  /** Applies a change unless the entry has been replaced or forgotten meanwhile. */
  function change(meetingId: string, entry: Entry, patch: Partial<CoachingState>) {
    if (meetings.get(meetingId) !== entry) return;
    entry.state = { ...entry.state, ...patch };
    emit();
  }

  const ended = (meetingId: string, entry: Entry, endReason: string | null, refunded: boolean) =>
    change(meetingId, entry, { phase: 'ended', endReason, refunded });

  /** The server refuses this account: stop following. Opening the meeting again looks afresh. */
  function forget(meetingId: string, entry: Entry) {
    if (meetings.get(meetingId) !== entry) return;
    meetings.delete(meetingId);
    emit();
  }

  const latestOrNull = (recordingId: string): Promise<LatestSessionResponse | null> =>
    api.latestSession(recordingId).catch(() => null);

  /**
   * What the server says about one session. A refusal of the stream or of /end is not proof: the backend also answers
   * 404 when it merely failed to read the session, and may then show no session at all.
   * `over`: it ended, or a newer one exists on the recording. `missing`: the server answered but showed neither.
   */
  async function lookUp(recordingId: string, sessionId: string) {
    let latest: LatestSessionResponse;
    try {
      latest = await api.latestSession(recordingId);
    } catch (error) {
      return { session: null, insights: [], over: false, missing: statusOf(error) === 404 };
    }
    const session = latest.session?.id === sessionId ? latest.session : null;
    return {
      session,
      insights: session ? latest.insights : [],
      over: session ? !!session.ended_at : !!latest.session,
      missing: !latest.session,
    };
  }

  async function requestSession(meetingId: string, entry: Entry, persona: string): Promise<string | null> {
    const { signal } = entry.abort;
    for (let attempt = 0; ; attempt++) {
      try {
        const { sessionId } = await api.startSession(entry.recordingId, persona);
        return signal.aborted ? null : sessionId;
      } catch (error) {
        if (signal.aborted) return null;
        if (isTransient(error) && attempt < startRetryMs.length) {
          await sleep(startRetryMs[attempt]!, signal);
          if (signal.aborted) return null;
          continue;
        }
        const status = statusOf(error);
        const startFailure: StartFailure = status === 402 ? 'no_credits' : status === 409 ? 'meeting_over' : 'other';
        const reason = (error as { body?: { end_reason?: unknown } | null }).body?.end_reason;
        change(meetingId, entry, {
          phase: 'not_started',
          startFailure,
          endReason: startFailure === 'meeting_over' && typeof reason === 'string' ? reason : null,
        });
        if (startFailure === 'other' && status !== 0 && status !== 401) options.onFailure?.('coach_start', status);
        return null;
      }
    }
  }

  /** Reads the live tips until the session ends, reconnecting whenever the connection drops. */
  async function follow(meetingId: string, entry: Entry, sessionId: string) {
    const { signal } = entry.abort;
    let attempt = 0;
    let refusedAndMissing = 0;
    while (!signal.aborted) {
      let over = false;
      let refused = false;
      let status = 0;
      let connectedAt: number | null = null;
      try {
        await api.streamSession(
          sessionId,
          (event) => {
            if (signal.aborted) return;
            if (event.type === 'connected') {
              connectedAt = performance.now();
              change(meetingId, entry, { phase: 'live' });
            } else if (event.type === 'tip') {
              if (!entry.state.insights.some((i) => i.id === event.insight.id)) {
                change(meetingId, entry, { insights: [event.insight, ...entry.state.insights] });
              }
            } else {
              over = true;
              ended(meetingId, entry, event.reason, event.refunded);
            }
          },
          signal
        );
      } catch (error) {
        if (signal.aborted) return;
        status = statusOf(error);
        if (status === 401 || status === 403) return forget(meetingId, entry);
        // 400: already ended. 404: gone, or the server could not read it.
        refused = status === 400 || status === 404;
      }
      if (over || signal.aborted) return;
      // A stream that opens and closes at once is not a recovery: keep backing off.
      if (connectedAt !== null && performance.now() - connectedAt >= stableAfterMs) attempt = 0;
      const found = await lookUp(entry.recordingId, sessionId);
      if (signal.aborted) return;
      // Tips given while we were not listening.
      if (found.session) change(meetingId, entry, { insights: newestFirst([...entry.state.insights, ...found.insights]) });
      refusedAndMissing = refused && found.missing ? refusedAndMissing + 1 : 0;
      if (found.over || refusedAndMissing >= REFUSALS_BEFORE_GONE) {
        return ended(meetingId, entry, found.session?.end_reason ?? null, found.session?.refunded === true);
      }
      change(meetingId, entry, { phase: 'reconnecting' });
      if (attempt === REPORT_AFTER_FAILURES) options.onFailure?.('coach_stream', status);
      await sleep(backoff(attempt++), signal);
    }
  }

  function saveStops() {
    const pending: PendingStop[] = Array.from(stops, ([sessionId, { recordingId }]) => ({ sessionId, recordingId }));
    try {
      options.storage?.setItem(STOPS_KEY, JSON.stringify(pending));
    } catch {
      /* storage unusable: the stop is still repeated as long as the page lives */
    }
  }

  function savedStops(): PendingStop[] {
    try {
      const saved = JSON.parse(options.storage?.getItem(STOPS_KEY) ?? '[]') as PendingStop[];
      return saved.filter((s) => typeof s?.sessionId === 'string' && typeof s.recordingId === 'string');
    } catch {
      return [];
    }
  }

  function dropStop(sessionId: string) {
    stops.get(sessionId)?.abort.abort();
    if (stops.delete(sessionId)) saveStops();
  }

  /** `repeat`: an earlier request for this stop may already have reached the server. */
  function sendStop(sessionId: string, recordingId: string, repeat: boolean) {
    stops.get(sessionId)?.abort.abort();
    const abort = new AbortController();
    stops.set(sessionId, { recordingId, abort });
    saveStops();
    void endOnServer(sessionId, recordingId, abort.signal, repeat);
  }

  async function endOnServer(sessionId: string, recordingId: string, signal: AbortSignal, repeat: boolean) {
    const creditReturned = (refunded: boolean) =>
      meetings.forEach((entry, meetingId) => {
        if (refunded && entry.sessionId === sessionId && entry.state.phase === 'ended') change(meetingId, entry, { refunded });
      });
    for (let attempt = 0; !signal.aborted; attempt++) {
      try {
        let { refunded } = await api.endSession(sessionId);
        // With the answer to an earlier try lost, the session itself says what happened to the credit.
        if (!refunded && (repeat || attempt > 0)) {
          const session = (await latestOrNull(recordingId))?.session;
          refunded = session?.id === sessionId && session.refunded === true;
        }
        if (signal.aborted) return;
        creditReturned(refunded);
        break;
      } catch (error) {
        // Signed out: repeating cannot help.
        const status = statusOf(error);
        if (status === 401 || status === 403) break;
        // A 404 stops the retries only once the session is seen to be over.
        if (status === 404) {
          const found = await lookUp(recordingId, sessionId);
          if (signal.aborted) return;
          if (found.over) {
            creditReturned(found.session?.refunded === true);
            break;
          }
        }
        await sleep(backoff(attempt), signal);
      }
    }
    if (!signal.aborted) dropStop(sessionId);
  }

  /** Starts coaching for a meeting. Safe to call from a page that is about to close. */
  function start(meetingId: string, recordingId: string, persona: string) {
    attaching.get(meetingId)?.abort();
    meetings.get(meetingId)?.abort.abort();
    const entry: Entry = { recordingId, persona, sessionId: null, abort: new AbortController(), state: fresh('starting') };
    meetings.set(meetingId, entry);
    emit();
    void (async () => {
      const sessionId = await requestSession(meetingId, entry, persona);
      if (!sessionId) return;
      // Asking for coaching again overrides a stop that never reached the server.
      dropStop(sessionId);
      entry.sessionId = sessionId;
      await follow(meetingId, entry, sessionId);
    })();
  }

  /** Picks up the session of a meeting being looked at when this tab does not know about it. Best effort. */
  async function attach(meetingId: string, recordingId: string): Promise<void> {
    if (meetings.has(meetingId) || attaching.has(meetingId)) return;
    const abort = new AbortController();
    attaching.set(meetingId, abort);
    let latest: LatestSessionResponse | null = null;
    for (let attempt = 0; !abort.signal.aborted; attempt++) {
      try {
        latest = await api.latestSession(recordingId);
        break;
      } catch (error) {
        if (!isTransient(error) || attempt >= startRetryMs.length) break;
        await sleep(startRetryMs[attempt]!, abort.signal);
      }
    }
    if (attaching.get(meetingId) === abort) attaching.delete(meetingId);
    const session = latest?.session;
    if (abort.signal.aborted || meetings.has(meetingId) || !latest || !session) return;
    const entry: Entry = {
      recordingId,
      persona: null,
      sessionId: session.id,
      abort: new AbortController(),
      state: fresh('reconnecting', newestFirst(latest.insights)),
    };
    meetings.set(meetingId, entry);
    emit();
    if (session.ended_at) ended(meetingId, entry, session.end_reason, session.refunded === true);
    else if (stops.has(session.id)) ended(meetingId, entry, STOPPED_BY_USER, false);
    else void follow(meetingId, entry, session.id);
  }

  // Stops pressed before a reload.
  savedStops().forEach((s) => sendStop(s.sessionId, s.recordingId, true));

  return {
    start,
    attach,
    /** Repeats a start that failed. The server returns the open session if the first request did reach it. */
    retry(meetingId: string) {
      const entry = meetings.get(meetingId);
      if (entry?.persona && entry.state.phase === 'not_started') start(meetingId, entry.recordingId, entry.persona);
    },
    /** The user's own stop. Repeated until the server has it: until then it keeps listening and calling the model. */
    stop(meetingId: string) {
      const entry = meetings.get(meetingId);
      if (!entry?.sessionId || (entry.state.phase !== 'live' && entry.state.phase !== 'reconnecting')) return;
      entry.abort.abort();
      ended(meetingId, entry, STOPPED_BY_USER, false);
      sendStop(entry.sessionId, entry.recordingId, false);
    },
    /** Signed out: the sessions belong to the account that left. Forget them and stop talking to the server. */
    reset() {
      meetings.forEach((m) => m.abort.abort());
      stops.forEach((s) => s.abort.abort());
      attaching.forEach((a) => a.abort());
      meetings.clear();
      stops.clear();
      attaching.clear();
      saveStops();
      emit();
    },
    /** Null when this tab knows of no session for the meeting. The same object until something changes. */
    getState: (meetingId: string): CoachingState | null => meetings.get(meetingId)?.state ?? null,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type CoachSession = ReturnType<typeof createCoachSession>;
