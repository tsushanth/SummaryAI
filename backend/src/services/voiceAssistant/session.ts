/**
 * One live meeting's assistant: a state machine fed with transcript events (partial and final) of ONE Recall bot.
 *
 * It only ever speaks when (a) it was addressed with the wake phrase at the start of an utterance, or (b) it plays its single
 * short intro (done by Recall when the bot joins, not here). Everything it needs from the outside is injected through
 * SessionDeps, so the whole behaviour (wake, cue, barge-in, stale answers, echo guard, caps, owner-only history) is tested with
 * a fake clock, fake TTS and a fake Recall.
 *
 * Timing definitions used by the metrics:
 *   t0   = the moment the final transcript of the question reached the backend
 *   ttfa = t0 -> first audio of the response accepted by Recall (the "Let me check" cue when enabled, else the answer)
 *   answerMs = t0 -> the answer audio accepted by Recall
 * Recall's own speech-to-text delay before t0 and its playback delay after the accept are NOT measured here.
 */
import type { VoiceAssistantConfig } from './config.js';
import type { AgentInput, AgentResult } from './agent.js';
import type { SpeechAudio } from './tts.js';
import { APOLOGY_TEXT, CUE_TEXT, INTRO_TEXT, LIMIT_TEXT } from './tts.js';
import type { VaEvent } from './metrics.js';
import { cleanSpoken, detectWake, isEchoOf, isStopRequest, STOP_RE, wordCount, type Speaker } from './wake.js';

export interface SessionMetrics {
  record(e: Omit<VaEvent, 'at'> & { at?: number }): void;
  hydrate(): Promise<void>;
  spendUsd(): number;
  userQuestionsToday(userId: string): number;
}

export interface SessionDeps {
  userId: string;
  meetingId: string;
  botName: string;
  cfg: () => VoiceAssistantConfig;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Re-evaluated on every event: the global kill switch and the user's opt-out take effect mid-meeting. */
  enabled: () => boolean;
  isOwner: (s: Speaker) => boolean;
  isOwnerEmailMatch: (s: Speaker) => boolean;
  answer: (input: Pick<AgentInput, 'question' | 'speakerName' | 'allowHistory' | 'recent' | 'liveText' | 'signal'>) => Promise<AgentResult>;
  synth: (text: string) => Promise<SpeechAudio>;
  /** Fixed phrases, cached for the life of the process. */
  phrase: (text: string) => Promise<SpeechAudio>;
  play: (b64: string) => Promise<void>;
  stop: () => Promise<void>;
  metrics: SessionMetrics;
  /** The bot plays INTRO_TEXT when it joins; its echo must not be mistaken for a participant. */
  introPlayed: boolean;
}

export interface TranscriptEvent {
  speaker: Speaker;
  text: string;
  partial: boolean;
}

interface Line { at: number; speaker: string; text: string }

const PENDING_WINDOW_MS = 12_000;
const ECHO_MEMORY_MS = 90_000;
const SLACK_MS = 500;
/** Recall splits a long question into several final segments; the asker's tail within this window is part of the question. */
const ASKER_GRACE_MS = 3000;
const RAPID_FIRE_COUNT = 4;
const RAPID_FIRE_WINDOW_MS = 15_000;

export class VoiceSession {
  private readonly d: SessionDeps;
  private lines: Line[] = [];
  private gen = 0;
  private busy = false;
  /** Who asked the current question and when: the asker finishing their own sentence is not a barge-in. */
  private asker: { name: string; at: number } | null = null;
  private playingUntil = 0;
  private pending: { speaker: string; until: number } | null = null;
  private questions = 0;
  private recent: Array<{ q: string; a: string }> = [];
  private spoken: Array<{ text: string; at: number }> = [];
  private starts: number[] = [];
  private limitNoticeSent = false;
  private disabled: string | null = null;
  private active = new Set<Promise<void>>();
  private cueAudio: SpeechAudio | null = null;
  lastEventAt: number;

  constructor(deps: SessionDeps) {
    this.d = deps;
    this.lastEventAt = deps.now();
    if (deps.introPlayed) this.spoken.push({ text: INTRO_TEXT, at: deps.now() });
    // Warm the fixed phrases now so the cue is instant when it is needed.
    if (deps.cfg().cue) deps.phrase(CUE_TEXT).then((a) => { this.cueAudio = a; }).catch(() => { /* no cue; answers still work */ });
    deps.phrase(APOLOGY_TEXT).catch(() => undefined);
  }

  /** Resolves when no answer is being produced (tests and shutdown). */
  async whenIdle(): Promise<void> {
    while (this.active.size > 0) await Promise.allSettled([...this.active]);
  }
  get questionCount(): number { return this.questions; }
  get disabledReason(): string | null { return this.disabled; }
  get isSpeaking(): boolean { return this.d.now() < this.playingUntil; }

  seed(lines: Array<{ at: number; speaker: string; text: string }>): void {
    if (this.lines.length === 0) this.lines = lines.slice(-400);
  }

  liveText(lastMinutes = 6): string {
    const since = this.d.now() - Math.min(Math.max(lastMinutes, 1), 30) * 60_000;
    const out = this.lines.filter((l) => l.at >= since).map((l) => `${l.speaker}: ${l.text}`).join('\n');
    return (out.length > 12_000 ? out.slice(out.length - 12_000) : out) || '(nothing said yet)';
  }

  private isBot(name: string | null): boolean {
    return !!name && name.trim().toLowerCase() === this.d.botName.trim().toLowerCase();
  }

  private looksLikeEcho(text: string, now: number): boolean {
    this.spoken = this.spoken.filter((s) => now - s.at < ECHO_MEMORY_MS);
    return this.spoken.some((s) => isEchoOf(text, s.text));
  }

  private remember(text: string): void { this.spoken.push({ text, at: this.d.now() }); }

  /** Entry point for every transcript event of this bot. Fast: answering continues in the background. */
  async onTranscript(ev: TranscriptEvent): Promise<void> {
    const text = (ev.text ?? '').trim();
    if (!text) return;
    const now = this.d.now();
    this.lastEventAt = now;
    const speaking = now < this.playingUntil;

    if (!this.d.enabled()) {
      // Kill switch / opt-out flipped while the meeting runs: go quiet immediately.
      if (speaking || this.busy) await this.bargeIn('thinking', speaking);
      return;
    }
    if (this.disabled) return;
    if (this.isBot(ev.speaker.name)) return; // the bot's own words, as Recall labels them

    // Echo guard: the bot's voice returns through the meeting audio and is transcribed like a participant.
    if (this.looksLikeEcho(text, now)) {
      if (!ev.partial) this.d.metrics.record({ type: 'echo_suppressed', userId: this.d.userId, meetingId: this.d.meetingId });
      return;
    }

    const wake = detectWake(text);
    const nWords = wordCount(text);
    // Barge-in: a stop word, someone talking over the bot (3+ words), or a new wake phrase while it is thinking.
    const askerContinuing = !!this.asker && this.asker.name === (ev.speaker.name ?? '') && now - this.asker.at < ASKER_GRACE_MS;
    if ((speaking || this.busy) && (STOP_RE.test(text) || (speaking && nWords >= 3 && !askerContinuing) || (!ev.partial && this.busy && !!wake))) {
      await this.bargeIn(speaking ? 'speaking' : 'thinking', speaking);
    }
    if (ev.partial) return;

    this.lines.push({ at: now, speaker: ev.speaker.name || 'Someone', text });
    if (this.lines.length > 400) this.lines.splice(0, this.lines.length - 400);
    if (this.busy) return;

    if (isStopRequest(text) && !wake) return; // a bare "stop" is not a question
    const speakerKey = ev.speaker.name ?? '';
    if (this.pending && this.pending.speaker === speakerKey && now < this.pending.until && !wake) {
      this.pending = null;
      this.begin(text, ev.speaker);
      return;
    }
    if (!wake) return;

    this.d.metrics.record({ type: 'wake', userId: this.d.userId, meetingId: this.d.meetingId });
    const q = wake.question;
    if (q && isStopRequest(q)) return; // "Meeting Mind, never mind"
    if (wordCount(q) >= 3) this.begin(q, ev.speaker);
    else this.pending = { speaker: speakerKey, until: now + PENDING_WINDOW_MS }; // wake phrase alone: the question comes next
  }

  private async bargeIn(phase: 'speaking' | 'thinking', wasSpeaking: boolean): Promise<void> {
    this.gen++;
    this.busy = false;
    this.pending = null;
    this.playingUntil = 0;
    this.d.metrics.record({ type: 'barge_in', userId: this.d.userId, meetingId: this.d.meetingId, detail: phase });
    if (wasSpeaking) {
      try { await this.d.stop(); } catch { this.d.metrics.record({ type: 'failed', userId: this.d.userId, meetingId: this.d.meetingId, failure: 'play', detail: 'stop' }); }
    }
  }

  private begin(question: string, speaker: Speaker): void {
    // Claim the session synchronously so a second wake phrase arriving while caps are being checked cannot start a second answer.
    this.busy = true;
    this.asker = { name: speaker.name ?? '', at: this.d.now() };
    const g = ++this.gen;
    // Not serialized: an older answer that is still thinking must never hold up a newer question (it is dropped when it returns).
    const p: Promise<void> = this.handleQuestion(question.slice(0, 300), speaker, g)
      .catch(() => undefined)
      .finally(() => { if (g === this.gen) this.busy = false; this.active.delete(p); });
    this.active.add(p);
  }

  private async handleQuestion(question: string, speaker: Speaker, g: number): Promise<void> {
    const { d } = this;
    const cfg = d.cfg();
    const base = { userId: d.userId, meetingId: d.meetingId };
    let now = d.now();

    // Caps. The global spend breaker and the per-user day cap are persisted through the metrics store (hydrate).
    await d.metrics.hydrate();
    if (d.metrics.spendUsd() >= cfg.dailySpendCapUsd) { d.metrics.record({ type: 'cap_hit', ...base, detail: 'spend' }); return; }
    if (this.questions >= cfg.maxQuestionsPerMeeting) { d.metrics.record({ type: 'cap_hit', ...base, detail: 'meeting' }); await this.sayLimitOnce(); return; }
    if (d.metrics.userQuestionsToday(d.userId) >= cfg.maxQuestionsPerUserPerDay) { d.metrics.record({ type: 'cap_hit', ...base, detail: 'user_day' }); await this.sayLimitOnce(); return; }

    // Self-trigger breaker: a bot that keeps answering itself must stop on its own.
    this.starts = this.starts.filter((t) => now - t < RAPID_FIRE_WINDOW_MS);
    this.starts.push(now);
    if (this.starts.length >= RAPID_FIRE_COUNT) { this.disabled = 'rapid_fire'; d.metrics.record({ type: 'cap_hit', ...base, detail: 'meeting' }); return; }

    if (g !== this.gen) return; // interrupted while the caps were being checked
    this.questions++;
    d.metrics.record({ type: 'question', ...base });
    const t0 = now;

    const allowHistory = cfg.historyPolicy === 'off' ? false
      : cfg.historyPolicy === 'anyone' ? true
      : cfg.historyPolicy === 'owner_email' ? d.isOwnerEmailMatch(speaker)
      : d.isOwner(speaker);
    const ownerSpeaker = allowHistory && cfg.historyPolicy !== 'anyone';
    if (!allowHistory) d.metrics.record({ type: 'history_denied', ...base, detail: 'non_owner' });

    let firstAudioMs: number | undefined;
    let cueEnd = 0;
    try {
      // Instant cue, so the question is not met with dead air while the answer is worked out.
      if (cfg.cue && this.cueAudio) {
        const cue = this.cueAudio;
        cueEnd = d.now() + cue.seconds * 1000;
        this.playingUntil = cueEnd + SLACK_MS;
        this.remember(CUE_TEXT);
        try {
          await d.play(cue.b64);
          firstAudioMs = d.now() - t0;
          d.metrics.record({ type: 'cue', ...base });
        } catch { cueEnd = 0; this.playingUntil = 0; /* the answer is still attempted */ }
      }

      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), cfg.answerTimeoutMs);
      timer.unref?.();
      let result: AgentResult;
      try {
        result = await d.answer({
          question, speakerName: speaker.name ?? '', allowHistory, recent: this.recent,
          liveText: (m) => this.liveText(m), signal: ac.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (g !== this.gen) return; // superseded or interrupted: not a failure
        const timedOut = ac.signal.aborted || /abort|timeout/i.test(String((err as Error)?.name ?? '') + String((err as Error)?.message ?? ''));
        d.metrics.record({ type: 'failed', ...base, failure: timedOut ? 'timeout' : 'llm' });
        if (cueEnd) await this.apologize(g);
        return;
      }
      clearTimeout(timer);

      const spoken = cleanSpoken(result.text, cfg.maxAnswerChars);
      if (!spoken) { d.metrics.record({ type: 'failed', ...base, failure: 'internal', llmUsd: result.usd }); if (cueEnd) await this.apologize(g); return; }
      if (g !== this.gen) { d.metrics.record({ type: 'stale_dropped', ...base, detail: 'superseded', llmUsd: result.usd }); return; }
      if (d.now() - t0 > cfg.staleAnswerMs) { d.metrics.record({ type: 'stale_dropped', ...base, detail: 'age', llmUsd: result.usd }); return; }

      let audio: SpeechAudio;
      try { audio = await d.synth(spoken); } catch {
        if (g === this.gen) d.metrics.record({ type: 'failed', ...base, failure: 'tts', llmUsd: result.usd });
        return;
      }
      if (g !== this.gen) { d.metrics.record({ type: 'stale_dropped', ...base, detail: 'superseded', llmUsd: result.usd, ttsUsd: audio.usd }); return; }
      if (d.now() - t0 > cfg.staleAnswerMs) { d.metrics.record({ type: 'stale_dropped', ...base, detail: 'age', llmUsd: result.usd, ttsUsd: audio.usd }); return; }

      // Let the cue finish so the two never overlap.
      now = d.now();
      if (cueEnd > now) await d.sleep(cueEnd - now + 150);
      if (g !== this.gen) { d.metrics.record({ type: 'stale_dropped', ...base, detail: 'superseded', llmUsd: result.usd, ttsUsd: audio.usd }); return; }

      this.playingUntil = d.now() + audio.seconds * 1000 + SLACK_MS;
      this.remember(spoken);
      try { await d.play(audio.b64); } catch {
        this.playingUntil = 0;
        d.metrics.record({ type: 'failed', ...base, failure: 'play', llmUsd: result.usd, ttsUsd: audio.usd });
        return;
      }
      const answerMs = d.now() - t0;
      this.recent.push({ q: question, a: spoken });
      if (this.recent.length > 3) this.recent.shift();
      d.metrics.record({
        type: 'answered', ...base, ttfaMs: firstAudioMs ?? answerMs, answerMs, llmMs: result.llmMs, ttsMs: audio.ms,
        llmUsd: result.usd, ttsUsd: audio.usd, found: result.found, ownerSpeaker, tools: result.tools.length, chars: spoken.length,
      });
    } catch {
      if (g === this.gen) d.metrics.record({ type: 'failed', ...base, failure: 'internal' });
    }
  }

  private async apologize(g: number): Promise<void> {
    try {
      const a = await this.d.phrase(APOLOGY_TEXT);
      if (g !== this.gen) return;
      this.playingUntil = this.d.now() + a.seconds * 1000 + SLACK_MS;
      this.remember(APOLOGY_TEXT);
      await this.d.play(a.b64);
    } catch { /* silence is acceptable when even the apology cannot be played */ }
  }

  private async sayLimitOnce(): Promise<void> {
    if (this.limitNoticeSent) return;
    this.limitNoticeSent = true;
    try {
      const a = await this.d.phrase(LIMIT_TEXT);
      this.playingUntil = this.d.now() + a.seconds * 1000 + SLACK_MS;
      this.remember(LIMIT_TEXT);
      await this.d.play(a.b64);
    } catch { /* best effort */ }
  }
}
