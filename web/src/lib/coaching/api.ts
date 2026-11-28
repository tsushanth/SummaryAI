/**
 * Client for /api/coaching (backend/src/routes/coaching.ts). The live tips arrive as server-sent events read with fetch,
 * because EventSource cannot send the Authorization header. No imports, so the node tests load this file directly.
 */

export interface CoachingInsight {
  id: string;
  session_id: string;
  /** "question" | "objection" | "signal" | "gap" */
  type: string;
  text: string;
  /** "now" | "soon" | "before-end" */
  urgency: string;
  transcript_offset_seconds: number | null;
  emitted_at: string;
}

export interface LatestSession {
  id: string;
  ended_at: string | null;
  refunded: boolean | null;
  /** Why the session gave nothing, when it gave nothing. */
  end_reason: string | null;
}

export interface LatestSessionResponse {
  session: LatestSession | null;
  insights: CoachingInsight[];
}

/** What the live tips stream says. "ended" is the server's last word on a session. */
export type CoachingStreamEvent =
  | { type: 'connected' }
  | { type: 'tip'; insight: CoachingInsight }
  | { type: 'ended'; reason: string | null; refunded: boolean };

export class CoachingApiError extends Error {
  /** HTTP status; 0 when no usable answer arrived (offline, timeout, dropped connection, no token yet). */
  status: number;
  body: unknown;

  constructor(status: number, body: unknown = null) {
    super(status ? `AI Coach request failed with status ${status}` : 'AI Coach request did not get an answer');
    this.name = 'CoachingApiError';
    this.status = status;
    this.body = body;
  }
}

export interface CoachingApi {
  /** One-time free sessions; the server grants them once per account however often this is called. */
  claimFreeCredits(): Promise<void>;
  /** Sessions left. */
  getCredits(): Promise<number>;
  /** Safe to repeat: the server returns the open session of a recording instead of taking a second credit. */
  startSession(recordingId: string, persona: string): Promise<{ sessionId: string }>;
  endSession(sessionId: string): Promise<{ refunded: boolean }>;
  latestSession(recordingId: string): Promise<LatestSessionResponse>;
  /** Resolves when the connection closes, with or without an "ended" event before it. */
  streamSession(sessionId: string, onEvent: (event: CoachingStreamEvent) => void, signal: AbortSignal): Promise<void>;
}

export interface SseFrame {
  event: string;
  data: string;
}

/** Feed it decoded text in any chunking; it calls back once per complete frame. Comment lines (heartbeats) are skipped. */
export function createSseParser(onFrame: (frame: SseFrame) => void): (chunk: string) => void {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  return (chunk) => {
    buffer += chunk;
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (line === '') {
        if (data.length) onFrame({ event: event || 'message', data: data.join('\n') });
        event = '';
        data = [];
        continue;
      }
      const colon = line.indexOf(':');
      if (colon === 0) continue;
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
  };
}

export function parseCoachingFrame({ event, data }: SseFrame): CoachingStreamEvent | null {
  let value: any;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (event === 'insight' && typeof value?.id === 'string' && typeof value.text === 'string') {
    return { type: 'tip', insight: value as CoachingInsight };
  }
  if (event === 'ended' && value) {
    return { type: 'ended', reason: typeof value.reason === 'string' ? value.reason : null, refunded: value.refunded === true };
  }
  return null;
}

export interface CoachingApiOptions {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  /** The server sends a heartbeat every 20 s: a stream silent for longer than this is dead. */
  idleTimeoutMs?: number;
  /** A 5xx answer, with the path stripped of ids. */
  onServerError?: (path: string, status: number) => void;
}

export function createCoachingApi({
  baseUrl,
  getToken,
  fetchFn = (input, init) => fetch(input, init),
  requestTimeoutMs = 30_000,
  idleTimeoutMs = 45_000,
  onServerError,
}: CoachingApiOptions): CoachingApi {
  const url = (path: string) => `${baseUrl}/api/coaching${path}`;

  // Without a token nothing is sent: a failed token refresh (offline) must not look like a refused account.
  const authorization = async (): Promise<string> => {
    const token = await getToken().catch(() => null);
    if (!token) throw new CoachingApiError(0);
    return `Bearer ${token}`;
  };

  const refusal = async (response: Response, path: string) => {
    if (response.status >= 500) onServerError?.(`/api/coaching${path.replace(/\/[0-9a-f-]{36}(?=\/|$)/gi, '/:id')}`, response.status);
    return new CoachingApiError(response.status, await response.json().catch(() => null));
  };

  async function request<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
    const Authorization = await authorization();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), requestTimeoutMs);
    try {
      const response = await fetchFn(url(path), {
        method: init.method ?? 'GET',
        headers: { Authorization, 'Content-Type': 'application/json' },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        keepalive: init.keepalive,
        signal: abort.signal,
      });
      if (!response.ok) throw await refusal(response, path);
      return (await response.json()) as T;
    } catch (error) {
      throw error instanceof CoachingApiError ? error : new CoachingApiError(0);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async claimFreeCredits() {
      await request('/credits/claim-free', { method: 'POST' });
    },
    async getCredits() {
      const { balance } = await request<{ balance: number }>('/credits');
      if (typeof balance !== 'number') throw new CoachingApiError(0);
      return balance;
    },
    async startSession(recordingId, persona) {
      const res = await request<{ session_id?: string }>('/sessions', {
        method: 'POST',
        body: { recording_id: recordingId, persona },
      });
      if (!res.session_id) throw new CoachingApiError(0);
      return { sessionId: res.session_id };
    },
    async endSession(sessionId) {
      // keepalive: a stop pressed just before the tab is closed or reloaded still reaches the server.
      const res = await request<{ refunded?: boolean }>(`/sessions/${sessionId}/end`, { method: 'POST', keepalive: true });
      return { refunded: res.refunded === true };
    },
    async latestSession(recordingId) {
      const res = await request<Partial<LatestSessionResponse>>(`/recordings/${recordingId}/session`);
      return { session: res.session ?? null, insights: res.insights ?? [] };
    },
    async streamSession(sessionId, onEvent, signal) {
      const path = `/sessions/${sessionId}/stream`;
      const Authorization = await authorization();
      if (signal.aborted) return;
      const abort = new AbortController();
      const cancel = () => abort.abort();
      signal.addEventListener('abort', cancel);
      let idle: ReturnType<typeof setTimeout> | undefined;
      const alive = () => {
        clearTimeout(idle);
        idle = setTimeout(cancel, idleTimeoutMs);
      };
      try {
        alive();
        const response = await fetchFn(url(path), {
          headers: { Authorization, Accept: 'text/event-stream' },
          cache: 'no-store',
          signal: abort.signal,
        });
        if (!response.ok) throw await refusal(response, path);
        if (!response.body) throw new CoachingApiError(0);
        onEvent({ type: 'connected' });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const feed = createSseParser((frame) => {
          const event = parseCoachingFrame(frame);
          if (event) onEvent(event);
        });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          alive();
          feed(decoder.decode(value, { stream: true }));
        }
      } catch (error) {
        throw error instanceof CoachingApiError ? error : new CoachingApiError(0);
      } finally {
        clearTimeout(idle);
        signal.removeEventListener('abort', cancel);
        abort.abort();
      }
    },
  };
}
