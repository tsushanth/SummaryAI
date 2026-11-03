import { randomUUID } from 'node:crypto';
import { ReplayBuffer, type AudioChunk } from './audio/replayBuffer.js';
import type { AlertHook } from './alerts.js';
import type { StreamLimiter } from './concurrency.js';
import { MeetingMetrics, type SessionState } from './metrics.js';
import type { Participant } from './recall/protocol.js';
import { Segmenter, type AbsToken, type RawSegment, type SegmenterOptions } from './segmenter.js';
import { DeliveryQueue } from './sink/queue.js';
import type { LiveSegment, SegmentSink } from './sink/types.js';
import { SpeakerMapper, type SpeakerMapperOptions } from './speakerMapper.js';
import type { SttConnection, SttEngine, SttError, SttUpdate } from './stt/types.js';

export interface SessionConfig {
  /** Already-sent audio kept for replay after a reconnect. */
  replayMs: number;
  /** Absolute cap on buffered audio (unsent audio beyond it is lost and counted as a gap). */
  hardCapMs: number;
  backoffMs: number[];
  rateLimitBackoffMs: number;
  capBackoffMs: number;
  /** Switch to the fallback engine after this long without a working stream. */
  failoverAfterMs: number;
  /** Soniox caps a stream at 300 minutes of audio. */
  maxStreamMs: number;
  /** Open the replacement stream this long before the cap. */
  rolloverMarginMs: number;
  /** Both streams receive audio for at least this long before the old one is retired. */
  overlapMs: number;
  promoteTimeoutMs: number;
  keepaliveMs: number;
  idleFlushMs: number;
  closeGraceMs: number;
  terms: string[];
  languageHints: string[];
  diarization: boolean;
  segmenter?: SegmenterOptions;
  mapper?: SpeakerMapperOptions;
  queueMax: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  // Measured on the real API (2026-11-03): final_audio_proc_ms trails total_audio_proc_ms by up to 7.1 s without endpoint
  // detection (5.8 s with it), so a 10 s window leaves under 3 s of margin. 15 s costs 0.5 MB per meeting.
  replayMs: 15_000,
  hardCapMs: 60_000,
  backoffMs: [500, 1000, 2000, 4000, 8000],
  rateLimitBackoffMs: 20_000,
  capBackoffMs: 5_000,
  failoverAfterMs: 30_000,
  maxStreamMs: 300 * 60_000,
  rolloverMarginMs: 5 * 60_000,
  overlapMs: 10_000,
  promoteTimeoutMs: 20_000,
  keepaliveMs: 10_000,
  idleFlushMs: 1500,
  closeGraceMs: 3000,
  terms: [],
  languageHints: [],
  diarization: true,
  queueMax: 500,
};

export interface SessionDeps {
  ref: string;
  sessionId?: string;
  engine: SttEngine;
  fallbackEngine?: SttEngine | undefined;
  sink: SegmentSink;
  config?: Partial<SessionConfig>;
  limiter?: StreamLimiter;
  alert?: AlertHook;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
}

interface Anchor { streamMs: number; relMs: number }

interface Slot {
  epoch: number;
  engine: SttEngine;
  conn: SttConnection | null;
  state: 'connecting' | 'open' | 'closing' | 'closed';
  anchors: Anchor[];
  sentMs: number;
  nextRelMs: number | null;
  finalWmStreamMs: number;
  openedAt: number;
  lastSendAt: number;
  held: AbsToken[];
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  stableTimer: ReturnType<typeof setTimeout> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  leased: boolean;
  gotUpdate: boolean;
  finished: (() => void) | null;
}

const ANCHOR_TOLERANCE_MS = 50;
const GAP_DETECT_MS = 500;
const MAX_ANCHORS = 256;
const MAX_HELD_TOKENS = 5000;
/** Replay starts this much BEFORE the vendor's final watermark: a word that straddles the watermark is not final yet and would otherwise
 * lose its first half. Tokens already emitted are filtered by the time watermark, so the overlap cannot duplicate words. */
const RESUME_MARGIN_MS = 1000;

/**
 * One meeting: Recall audio in, final segments out. Owns the replay buffer, the Soniox stream(s) and everything that keeps them
 * alive (reconnect with replay from the vendor's final watermark, 300-minute rollover with overlap, failover to a second engine).
 *
 * Clocks: Recall chunks carry `timestamp.relative` (ms since recording start, "rel"). A Soniox stream has its own clock starting at
 * its first audio byte ("stream ms"). Each slot keeps anchors {streamMs, relMs} added whenever consecutive chunks are not
 * contiguous (including the first), so token times map back to rel exactly even across Recall gaps and replays.
 */
export class MeetingSession {
  readonly metrics = new MeetingMetrics();
  readonly ref: string;
  readonly sessionId: string;
  botId: string | null = null;

  private readonly cfg: SessionConfig;
  private readonly buffer: ReplayBuffer;
  private readonly segmenter: Segmenter;
  private readonly mapper: SpeakerMapper;
  private readonly queue: DeliveryQueue;

  private engine: SttEngine;
  private usingFallback = false;
  private active: Slot | null = null;
  private pending: Slot | null = null;
  private lastActive: Slot | null = null;
  private epochCounter = 0;
  private seq = 0;
  private stateV: SessionState = 'connecting';
  private started = false;
  private closed = false;
  private closing = false;

  private lastEndRel: number | null = null;
  private tokenWatermarkMs = -1;
  private attempt = 0;
  private downSince: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private rolloverRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private promoteTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly d: SessionDeps) {
    this.cfg = { ...DEFAULT_SESSION_CONFIG, ...d.config };
    this.ref = d.ref;
    this.sessionId = d.sessionId ?? randomUUID();
    this.engine = d.engine;
    this.buffer = new ReplayBuffer({ retainMs: this.cfg.replayMs, hardCapMs: this.cfg.hardCapMs });
    this.segmenter = new Segmenter(this.cfg.segmenter);
    this.mapper = new SpeakerMapper(this.cfg.mapper);
    this.queue = new DeliveryQueue(d.sink, { metrics: this.metrics, maxQueue: this.cfg.queueMax });
  }

  setBotId(id: string): void {
    this.botId = id;
  }

  state(): SessionState {
    return this.stateV;
  }

  private setState(s: SessionState): void {
    this.stateV = s;
    this.metrics.set('state', s);
  }

  debug(): { bufferedBytes: number; queueLength: number; heldTokens: number; anchors: number; pendingWords: number } {
    return {
      bufferedBytes: this.buffer.bytes(),
      queueLength: this.queue.length(),
      heldTokens: (this.pending?.held.length ?? 0),
      anchors: Math.max(this.active?.anchors.length ?? 0, this.pending?.anchors.length ?? 0),
      pendingWords: this.segmenter.pendingWords(),
    };
  }

  // ---------------------------------------------------------------- Recall side

  handleSpeech(ev: { on: boolean; participant: Participant; relMs: number }): void {
    if (this.closed) return;
    this.mapper.onSpeech(ev);
  }

  handleAudio(a: AudioChunk): void {
    if (this.closed || this.closing) return;
    if (a.pcm.length === 0 || a.pcm.length % 2 !== 0) {
      this.metrics.add('invalidMessages');
      return;
    }
    // A chunk that ends before what we already have is a duplicate (e.g. Recall reconnect resend): ignore it.
    if (this.lastEndRel !== null && a.relMs + a.durMs <= this.lastEndRel) return;
    this.metrics.add('audioSecondsIn', a.durMs / 1000);
    this.metrics.set('lastAudioAt', Date.now());
    if (this.lastEndRel !== null && a.relMs - this.lastEndRel > GAP_DETECT_MS) {
      this.metrics.add('gaps');
      this.metrics.add('gapSeconds', (a.relMs - this.lastEndRel) / 1000);
    }
    this.lastEndRel = a.relMs + a.durMs;

    if (this.stateV === 'degraded') {
      // No engine left to take the audio. Do not buffer it; account for it honestly.
      this.metrics.add('gapSeconds', a.durMs / 1000);
      return;
    }
    const lostBefore = this.buffer.lostMs();
    this.buffer.push(a);
    const lostNow = this.buffer.lostMs() - lostBefore;
    if (lostNow > 0) {
      this.metrics.add('gaps');
      this.metrics.add('gapSeconds', lostNow / 1000);
    }

    if (!this.started) {
      this.started = true;
      this.connectActive(null);
      return;
    }
    const act = this.active;
    if (act && act.state === 'open') {
      if (this.sendChunk(act, a)) this.buffer.markSent(a.relMs + a.durMs);
      else return;
      const pend = this.pending;
      if (pend && pend.state === 'open') this.sendChunk(pend, a);
      if (!pend && act.sentMs >= this.cfg.maxStreamMs - this.cfg.rolloverMarginMs) this.startRollover();
    }
  }

  // ---------------------------------------------------------------- stream management

  private newSlot(engine: SttEngine): Slot {
    return {
      epoch: this.epochCounter++, engine, conn: null, state: 'connecting', anchors: [], sentMs: 0, nextRelMs: null, finalWmStreamMs: 0,
      openedAt: 0, lastSendAt: Date.now(), held: [], keepaliveTimer: null, stableTimer: null, closeTimer: null, leased: false,
      gotUpdate: false, finished: null,
    };
  }

  private toAbs(slot: Slot, streamMs: number): number {
    const an = slot.anchors;
    for (let i = an.length - 1; i >= 0; i--) {
      if (an[i]!.streamMs <= streamMs) return an[i]!.relMs + (streamMs - an[i]!.streamMs);
    }
    return an.length ? an[0]!.relMs + (streamMs - an[0]!.streamMs) : streamMs;
  }

  private finalWmAbs(slot: Slot): number | null {
    if (slot.anchors.length === 0) return null;
    return this.toAbs(slot, slot.finalWmStreamMs);
  }

  private sendChunk(slot: Slot, c: AudioChunk): boolean {
    if (!slot.conn || slot.state !== 'open') return false;
    if (slot.nextRelMs === null || Math.abs(c.relMs - slot.nextRelMs) > ANCHOR_TOLERANCE_MS) {
      slot.anchors.push({ streamMs: slot.sentMs, relMs: c.relMs });
      if (slot.anchors.length > MAX_ANCHORS) slot.anchors.splice(0, slot.anchors.length - MAX_ANCHORS);
    }
    try {
      slot.conn.sendAudio(c.pcm);
    } catch {
      this.onSlotClosed(slot, { clean: false });
      return false;
    }
    slot.sentMs += c.durMs;
    slot.nextRelMs = c.relMs + c.durMs;
    slot.lastSendAt = Date.now();
    this.metrics.add('audioSecondsSent', c.durMs / 1000);
    return true;
  }

  private replay(slot: Slot, resumeAbs: number | null): void {
    const from = resumeAbs ?? -1;
    const chunks = this.buffer.chunksFrom(from);
    const first = chunks[0];
    if (resumeAbs !== null && first && first.relMs > resumeAbs + 1) {
      // The audio between the vendor's final watermark and the oldest buffered chunk is gone.
      const lost = first.relMs - resumeAbs;
      this.metrics.add('gaps');
      this.metrics.add('gapSeconds', lost / 1000);
    }
    let lastEnd = -1;
    for (const c of chunks) {
      if (!this.sendChunk(slot, c)) return;
      lastEnd = c.relMs + c.durMs;
    }
    if (lastEnd >= 0 && slot === this.active) this.buffer.markSent(lastEnd);
  }

  private connectActive(resumeAbs: number | null): void {
    if (this.closed || this.closing || this.stateV === 'degraded') return;
    if (this.d.limiter && !this.d.limiter.acquire()) {
      this.d.alert?.('mm_stream_cap', { ref: this.ref, cap: this.d.limiter.capacity() });
      this.scheduleReconnect(resumeAbs, this.cfg.capBackoffMs);
      return;
    }
    const slot = this.newSlot(this.engine);
    slot.leased = !!this.d.limiter;
    this.openSlot(slot, 'active', resumeAbs);
  }

  private openSlot(slot: Slot, role: 'active' | 'pending', resumeAbs: number | null): void {
    if (role === 'active') this.active = slot;
    else this.pending = slot;
    slot.engine
      .connect(
        { terms: this.cfg.terms, languageHints: this.cfg.languageHints, diarization: this.cfg.diarization },
        {
          onUpdate: (u) => this.onUpdate(slot, u),
          onClose: (info) => this.onSlotClosed(slot, info),
        },
      )
      .then((conn) => {
        if (this.closed || slot.state === 'closed') { try { conn.close(); } catch { /* */ } return; }
        slot.conn = conn;
        slot.state = 'open';
        slot.openedAt = Date.now();
        slot.keepaliveTimer = setInterval(() => this.keepalive(slot), Math.max(1000, Math.floor(this.cfg.keepaliveMs)));
        slot.stableTimer = setTimeout(() => this.markStable(), 5000);
        if (role === 'active') this.setState('streaming');
        this.replay(slot, resumeAbs);
        if (role === 'pending' && slot.state === 'open') this.schedulePromoteCheck();
      })
      .catch((err: Error & { sttError?: SttError }) => {
        this.d.log?.('stt connect failed', { engine: slot.engine.name, code: err.sttError?.code ?? null, type: err.sttError?.type ?? 'connect_error' });
        this.onSlotClosed(slot, { clean: false, error: err.sttError ?? undefined }, true);
      });
  }

  private markStable(): void {
    this.attempt = 0;
    this.downSince = null;
  }

  private keepalive(slot: Slot): void {
    if (slot.state !== 'open' || !slot.conn) return;
    if (Date.now() - slot.lastSendAt < this.cfg.keepaliveMs - 1) return;
    try {
      slot.conn.keepalive();
      slot.lastSendAt = Date.now();
    } catch {
      this.onSlotClosed(slot, { clean: false });
    }
  }

  private teardown(slot: Slot): void {
    if (slot.keepaliveTimer) clearInterval(slot.keepaliveTimer);
    if (slot.stableTimer) clearTimeout(slot.stableTimer);
    if (slot.closeTimer) clearTimeout(slot.closeTimer);
    slot.keepaliveTimer = slot.stableTimer = slot.closeTimer = null;
    if (slot.leased) { slot.leased = false; this.d.limiter?.release(); }
    slot.state = 'closed';
    const f = slot.finished;
    slot.finished = null;
    f?.();
  }

  private onSlotClosed(slot: Slot, info: { clean: boolean; error?: SttError | undefined }, connectFailure = false): void {
    if (slot.state === 'closed') return;
    const wasClosing = slot.state === 'closing';
    const wasOpen = slot.state === 'open';
    try { if (wasOpen) slot.conn?.close(); } catch { /* */ }
    this.teardown(slot);
    if (wasClosing || this.closed) return;

    if (slot === this.pending) {
      this.pending = null;
      this.clearPromote();
      if (this.active && this.active.state === 'open' && !this.closing) {
        this.rolloverRetryTimer = setTimeout(() => { this.rolloverRetryTimer = null; if (!this.pending && this.active?.state === 'open') this.startRollover(); }, 5000);
      }
      return;
    }
    if (slot !== this.active) return;

    this.lastActive = slot;
    this.active = null;
    if (!connectFailure) this.metrics.add('reconnects');
    if (this.pending && this.pending.state === 'open') {
      // The rollover stream is already up: it takes over immediately.
      this.promote(false);
      return;
    }
    if (this.closing) return;
    this.setState('reconnecting');
    this.handleFailure(info.error);
  }

  private resumePoint(): number | null {
    const prev = this.lastActive;
    if (!prev) return null;
    const wm = this.finalWmAbs(prev);
    if (wm !== null) return Math.max(prev.anchors[0]?.relMs ?? 0, wm - RESUME_MARGIN_MS);
    return prev.anchors[0]?.relMs ?? null;
  }

  private handleFailure(err?: SttError): void {
    const now = Date.now();
    if (this.downSince === null) this.downSince = now;
    if (err?.rateLimited) this.d.alert?.('soniox_concurrency_429', { ref: this.ref, code: err.code, type: err.type });
    if (err?.fatal) {
      this.d.alert?.('soniox_fatal', { ref: this.ref, code: err.code, type: err.type, engine: this.engine.name });
      if (this.canFailover()) { this.failover(); return; }
      this.degrade();
      return;
    }
    if (this.canFailover() && now - this.downSince >= this.cfg.failoverAfterMs) { this.failover(); return; }
    const base = this.cfg.backoffMs[Math.min(this.attempt, this.cfg.backoffMs.length - 1)] ?? 1000;
    this.attempt++;
    const delay = err?.rateLimited ? Math.max(base, this.cfg.rateLimitBackoffMs) : base;
    this.scheduleReconnect(this.resumePoint(), delay);
  }

  private scheduleReconnect(resume: number | null, delayMs: number): void {
    if (this.reconnectTimer || this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectActive(resume ?? this.resumePoint());
    }, delayMs);
  }

  private canFailover(): boolean {
    return !!this.d.fallbackEngine && !this.usingFallback;
  }

  private failover(): void {
    this.usingFallback = true;
    this.engine = this.d.fallbackEngine!;
    this.attempt = 0;
    this.downSince = Date.now();
    this.metrics.add('failovers');
    this.d.alert?.('stt_failover', { ref: this.ref, to: this.engine.name });
    this.d.log?.('failing over', { to: this.engine.name });
    this.connectActive(this.resumePoint());
  }

  private degrade(): void {
    this.setState('degraded');
    this.metrics.set('degraded', true);
    this.d.alert?.('live_degraded', { ref: this.ref });
    // Free the memory; the batch pass will produce the final transcript.
    this.buffer.resetSent();
  }

  // ---------------------------------------------------------------- rollover

  private startRollover(): void {
    if (this.pending || this.closed || this.closing || !this.active || this.active.state !== 'open') return;
    if (this.d.limiter && !this.d.limiter.acquire()) {
      this.d.alert?.('mm_stream_cap', { ref: this.ref, cap: this.d.limiter.capacity(), during: 'rollover' });
      this.rolloverRetryTimer = setTimeout(() => { this.rolloverRetryTimer = null; this.startRollover(); }, this.cfg.capBackoffMs);
      return;
    }
    const slot = this.newSlot(this.engine);
    slot.leased = !!this.d.limiter;
    const wm = this.finalWmAbs(this.active);
    this.openSlot(slot, 'pending', wm === null ? null : Math.max(this.active.anchors[0]?.relMs ?? 0, wm - RESUME_MARGIN_MS));
  }

  private clearPromote(): void {
    if (this.promoteTimer) clearTimeout(this.promoteTimer);
    this.promoteTimer = null;
  }

  private schedulePromoteCheck(): void {
    this.clearPromote();
    const p = this.pending;
    if (!p) return;
    const wait = Math.max(0, p.openedAt + this.cfg.overlapMs - Date.now());
    this.promoteTimer = setTimeout(() => this.promoteCheck(), wait);
  }

  private promoteCheck(): void {
    this.promoteTimer = null;
    const p = this.pending, a = this.active;
    if (!p || p.state !== 'open') return;
    if (!a || a.state !== 'open') { this.promote(false); return; }
    const elapsed = Date.now() - p.openedAt;
    const pw = this.finalWmAbs(p), aw = this.finalWmAbs(a);
    const ready = pw !== null && (aw === null || pw >= aw);
    if ((elapsed >= this.cfg.overlapMs && ready) || elapsed >= this.cfg.promoteTimeoutMs) this.promote(true);
    else this.promoteTimer = setTimeout(() => this.promoteCheck(), 250);
  }

  private promote(retireOld: boolean): void {
    const p = this.pending;
    if (!p) return;
    const old = this.active;
    this.pending = null;
    this.active = p;
    this.clearPromote();
    this.setState('streaming');
    this.metrics.add('rollovers', retireOld ? 1 : 0);
    if (old && retireOld) this.retire(old);
    const held = p.held;
    p.held = [];
    this.consume(held);
  }

  private retire(slot: Slot): void {
    slot.state = 'closing';
    try { slot.conn?.finalize(); slot.conn?.endStream(); } catch { /* */ }
    slot.closeTimer = setTimeout(() => { try { slot.conn?.close(); } catch { /* */ } this.teardown(slot); }, this.cfg.closeGraceMs);
  }

  // ---------------------------------------------------------------- tokens -> segments

  private onUpdate(slot: Slot, u: SttUpdate): void {
    try {
      if (slot.state === 'closed') return;
      slot.gotUpdate = true;
      if (u.finalAudioProcMs !== undefined) slot.finalWmStreamMs = Math.max(slot.finalWmStreamMs, u.finalAudioProcMs);
      if (slot === this.active && !this.closing) this.markStableSoon();
      if (u.finished && slot.finished) slot.finished();
      const abs: AbsToken[] = [];
      for (const t of u.tokens) {
        if (!t.isFinal) { if (slot === this.active) this.metrics.add('partialsSeen'); continue; }
        if (t.control) { abs.push({ text: '', startMs: -1, endMs: -1, epoch: slot.epoch, control: t.control }); continue; }
        const s = this.toAbs(slot, t.startMs);
        abs.push({ text: t.text, startMs: s, endMs: s + Math.max(0, t.endMs - t.startMs), speaker: t.speaker, language: t.language, epoch: slot.epoch });
      }
      if (slot === this.pending) {
        if (slot.held.length + abs.length <= MAX_HELD_TOKENS) slot.held.push(...abs);
        return;
      }
      if (slot !== this.active || slot.state === 'closing' && !this.closing) return;
      this.consume(abs);
    } catch (e) {
      this.d.log?.('onUpdate error', { err: (e as Error).name });
    }
  }

  private markStableSoon(): void {
    if (this.downSince !== null && this.active?.gotUpdate) this.markStable();
  }

  private consume(tokens: AbsToken[]): void {
    const fresh: AbsToken[] = [];
    for (const t of tokens) {
      if (t.control) { fresh.push(t); continue; }
      const mid = (t.startMs + t.endMs) / 2;
      if (mid < this.tokenWatermarkMs) { this.metrics.add('dedupedTokens'); continue; }
      fresh.push(t);
      this.tokenWatermarkMs = Math.max(this.tokenWatermarkMs, t.endMs);
    }
    if (fresh.every((t) => t.control)) { this.emit(this.segmenter.push(fresh)); return; }
    this.emit(this.segmenter.push(fresh));
    this.scheduleIdleFlush();
  }

  private scheduleIdleFlush(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.emit(this.segmenter.flush());
    }, this.cfg.idleFlushMs);
  }

  private emit(segs: RawSegment[]): void {
    for (const s of segs) {
      const label = s.speaker === '?' ? '1' : s.speaker;
      const who = this.mapper.resolve({ epoch: s.epoch, label, startMs: s.startMs, endMs: s.endMs });
      const seq = this.seq++;
      const out: LiveSegment = {
        key: `${this.sessionId}:${seq}`, seq, botId: this.botId, ref: this.ref, sessionId: this.sessionId,
        segment_text: s.text, speaker_id: who.speakerId, speaker_name: who.speakerName, is_host: who.isHost,
        start_timestamp: s.startMs / 1000, end_timestamp: s.endMs / 1000,
        words: s.words.map((w) => ({ text: w.text, start_timestamp: { relative: w.startMs / 1000 }, end_timestamp: { relative: w.endMs / 1000 } })),
        is_partial: false, language: s.language,
      };
      this.queue.enqueue(out);
    }
  }

  // ---------------------------------------------------------------- shutdown

  async close(): Promise<void> {
    if (this.closed || this.closing) return;
    this.closing = true;
    for (const t of [this.reconnectTimer, this.rolloverRetryTimer, this.promoteTimer]) if (t) clearTimeout(t);
    this.reconnectTimer = this.rolloverRetryTimer = this.promoteTimer = null;
    const act = this.active;
    if (act && act.state === 'open' && act.conn) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, this.cfg.closeGraceMs);
        act.finished = () => { clearTimeout(t); resolve(); };
        try { act.conn!.finalize(); act.conn!.endStream(); } catch { clearTimeout(t); resolve(); }
      });
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.emit(this.segmenter.flush());
    for (const s of [this.active, this.pending]) {
      if (!s) continue;
      try { s.conn?.close(); } catch { /* */ }
      this.teardown(s);
    }
    this.active = this.pending = null;
    await this.queue.drain(5000);
    this.closed = true;
    this.setState('closed');
  }
}
