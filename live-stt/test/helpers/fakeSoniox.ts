import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Fixture, ScriptWord, Who } from '../harness/fixture.js';

/**
 * Fake Soniox realtime server for tests. Message shapes were confirmed against the REAL API on 2026-11-03
 * (scripts/probe-real.ts): config frame JSON first; binary audio frames; responses {tokens:[{text,start_ms,end_ms,confidence,
 * is_final,speaker,language}], final_audio_proc_ms, total_audio_proc_ms}; the first token of a stream has no leading space,
 * later tokens do; punctuation is its own token; non-final tokens are re-sent in every message until they finalize; finals arrive
 * in batches roughly every 4 s of audio (final_audio_proc_ms steps of ~4080 ms) and about 3-6 s after the word; first partials
 * about 0.85 s after the word ends; {"type":"finalize"} answers with a <fin> token; endpoint detection adds <end> tokens;
 * an empty text frame ends the stream with {finished:true} and a 1000 close; errors are {error_code,error_type,error_message}.
 *
 * The fake does not decode audio. It identifies WHICH 200 ms block of the reference meeting each received block is (exact hash,
 * the fixture is dithered so every block is unique) and "recognises" a scripted word only when every block of it arrived on THAT
 * stream. So audio lost between streams really does become words lost from the transcript.
 * Timing is in AUDIO time (processed stream ms), so tests run fast at any replay speed; `latencyMs` adds wall-clock network delay.
 */

export interface FakeSonioxOptions {
  fixture: Fixture;
  latencyMs?: number;
  partialLagMs?: number;
  finalStepMs?: number;
  finalLagMs?: number;
  /** Drop (terminate, no close frame) stream #n once it has processed this many ms of audio. */
  dropStream?: { index: number; atAudioMs: number };
  /** Swap speaker labels 1<->2 on streams after the first (real diarization can renumber speakers on a new stream). */
  swapLabelsAfterFirst?: boolean;
  /** Reject the next N connections with this error frame (then close). */
  rejectNext?: { count: number; error_code: number; error_type: string };
  /** Real server ends a stream with 408 after 20 s with neither audio nor keepalive. */
  idleTimeoutMs?: number;
  /** End a stream with 413 max_duration_reached after this much audio. */
  maxStreamMs?: number;
}

interface WordState { w: ScriptWord & { who: Who }; final: boolean }

export interface FakeStream {
  index: number;
  config: Record<string, unknown> | null;
  blocks: number[];
  processedMs: number;
  keepalives: number;
  finalizes: number;
  ended: boolean;
  closedBy: 'client' | 'drop' | 'error' | 'finished' | 'open';
  sawApiKeyInFrame: boolean;
  sawBearerHeader: boolean;
}

const BLOCK = 6400;

export class FakeSoniox {
  readonly streams: FakeStream[] = [];
  private wss!: WebSocketServer;
  private readonly hashToIdx = new Map<string, number>();
  private readonly words: (ScriptWord & { who: Who })[];
  private rejects: { count: number; error_code: number; error_type: string } | undefined;
  port = 0;

  constructor(private readonly o: FakeSonioxOptions) {
    this.rejects = o.rejectNext ? { ...o.rejectNext } : undefined;
    const pcm = o.fixture.pcm;
    for (let i = 0, off = 0; off + BLOCK <= pcm.length; i++, off += BLOCK) {
      this.hashToIdx.set(createHash('sha1').update(pcm.subarray(off, off + BLOCK)).digest('hex'), i);
    }
    this.words = o.fixture.utterances.flatMap((u) => u.words.map((w) => ({ ...w, who: u.who })));
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}/transcribe-websocket`;
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => {
        this.port = (this.wss.address() as { port: number }).port;
        resolve();
      });
      this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    });
  }

  stop(): Promise<void> {
    for (const c of this.wss.clients) c.terminate();
    return new Promise((r) => this.wss.close(() => r()));
  }

  /** Reference blocks received by ANY stream. */
  coveredBlocks(): Set<number> {
    const s = new Set<number>();
    for (const st of this.streams) for (const b of st.blocks) s.add(b);
    return s;
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const index = this.streams.length;
    const st: FakeStream = { index, config: null, blocks: [], processedMs: 0, keepalives: 0, finalizes: 0, ended: false, closedBy: 'open', sawApiKeyInFrame: false, sawBearerHeader: /^Bearer .+/.test(String(req.headers.authorization ?? '')) };
    this.streams.push(st);

    if (this.rejects && this.rejects.count > 0) {
      this.rejects.count--;
      const { error_code, error_type } = this.rejects;
      setTimeout(() => {
        ws.send(JSON.stringify({ error_code, error_type, error_message: 'simulated', more_info: null, request_id: 'fake' }));
        st.closedBy = 'error';
        ws.close(1011);
      }, 5);
      return;
    }

    const o = this.o;
    const lat = o.latencyMs ?? 15;
    const partialLag = o.partialLagMs ?? 850;
    const step = o.finalStepMs ?? 4080;
    const finalLag = o.finalLagMs ?? 3000;
    const blockStream = new Map<number, number>(); // reference block -> stream block seq
    const states: WordState[] = this.words.map((w) => ({ w, final: false }));
    let carry = Buffer.alloc(0);
    let finalWm = 0;
    let firstWord: WordState | null = null;
    let lastActivity = Date.now();
    const labelOf = (who: Who) => {
      const base = who === 'alice' ? '1' : '2';
      return o.swapLabelsAfterFirst && index > 0 ? (base === '1' ? '2' : '1') : base;
    };
    const send = (obj: unknown) => { setTimeout(() => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }, lat); };
    const streamMs = (refMs: number): number | null => {
      const b = Math.floor(refMs / 200);
      const seq = blockStream.get(b);
      return seq === undefined ? null : seq * 200 + (refMs - b * 200);
    };
    const covered = (w: ScriptWord): boolean => {
      for (let b = Math.floor(w.startMs / 200); b <= Math.floor(w.endMs / 200); b++) if (!blockStream.has(b)) return false;
      return true;
    };
    const tokensFor = (s: WordState, final: boolean): Record<string, unknown>[] => {
      const a = streamMs(s.w.startMs)!;
      const b = streamMs(s.w.endMs)!;
      const m = /^(.*?)([.,?!]*)$/.exec(s.w.text)!;
      const body = m[1]!, punct = m[2]!;
      if (!firstWord) firstWord = s;
      const lead = firstWord === s ? '' : ' ';
      const mk = (text: string, sMs: number, eMs: number) => ({ text, start_ms: sMs, end_ms: eMs, confidence: 0.97, is_final: final, speaker: labelOf(s.w.who), language: 'en' });
      const out: Record<string, unknown>[] = [];
      const mid = Math.round((a + b) / 2);
      if (body.length > 8) { out.push(mk(lead + body.slice(0, 4), a, mid)); out.push(mk(body.slice(4), mid, b)); } else out.push(mk(lead + body, a, b));
      if (punct) out.push(mk(punct, b, b));
      return out;
    };

    const emit = (flush: boolean, fin: boolean): void => {
      const P = st.processedMs;
      if (flush) finalWm = P;
      else {
        const target = Math.floor(Math.max(0, P - finalLag) / step) * step;
        if (target > finalWm) finalWm = target;
      }
      const tokens: Record<string, unknown>[] = [];
      const known = states.filter((s) => covered(s.w));
      for (const s of known) {
        const e = streamMs(s.w.endMs)!;
        if (!s.final && e <= finalWm && e <= P) {
          s.final = true;
          const toks = tokensFor(s, true);
          tokens.push(...toks);
          const lastTok = toks[toks.length - 1]!;
          if (String(st.config?.enable_endpoint_detection) === 'true' && /[.?!]$/.test(String(lastTok.text))) tokens.push({ text: '<end>', is_final: true });
        }
      }
      // Non-final tokens are re-sent in full on every message until they finalize.
      for (const s of known) {
        const e = streamMs(s.w.endMs)!;
        if (!s.final && (e + partialLag <= P || flush)) tokens.push(...tokensFor(s, false).map((t) => ({ ...t })));
      }
      if (fin) tokens.push({ text: '<fin>', is_final: true });
      send({ tokens, final_audio_proc_ms: Math.min(finalWm, P), total_audio_proc_ms: P });
    };

    const onBlock = (buf: Buffer) => {
      const idx = this.hashToIdx.get(createHash('sha1').update(buf).digest('hex'));
      const seq = st.blocks.length;
      if (idx !== undefined) { blockStream.set(idx, seq); }
      st.blocks.push(idx ?? -1);
      st.processedMs += 200;
      if (o.dropStream && o.dropStream.index === index && st.processedMs >= o.dropStream.atAudioMs) {
        st.closedBy = 'drop';
        ws.terminate();
        return false;
      }
      if (o.maxStreamMs && st.processedMs >= o.maxStreamMs) {
        send({ error_code: 413, error_type: 'max_duration_reached', error_message: 'simulated' });
        st.closedBy = 'error';
        setTimeout(() => ws.close(1011), lat + 5);
        return false;
      }
      emit(false, false);
      return true;
    };

    const idle = setInterval(() => {
      if (Date.now() - lastActivity > (o.idleTimeoutMs ?? 20_000)) {
        send({ error_code: 408, error_type: 'request_timeout', error_message: 'simulated' });
        st.closedBy = 'error';
        setTimeout(() => ws.close(1011), lat + 5);
        clearInterval(idle);
      }
    }, 250);

    ws.on('message', (data, isBinary) => {
      lastActivity = Date.now();
      if (isBinary) {
        carry = Buffer.concat([carry, data as Buffer]);
        while (carry.length >= BLOCK) {
          const blk = carry.subarray(0, BLOCK);
          carry = carry.subarray(BLOCK);
          if (!onBlock(Buffer.from(blk))) return;
        }
        return;
      }
      const text = data.toString();
      if (text === '') {
        st.ended = true;
        emit(true, false);
        send({ tokens: [], final_audio_proc_ms: st.processedMs, total_audio_proc_ms: st.processedMs, finished: true });
        st.closedBy = 'finished';
        setTimeout(() => ws.close(1000), lat + 10);
        return;
      }
      let m: any;
      try { m = JSON.parse(text); } catch { return; }
      if (!st.config) {
        st.config = m;
        st.sawApiKeyInFrame = typeof m.api_key === 'string';
        // Validate the documented required fields; a real server rejects a bad config with error 400.
        const ok = typeof m.model === 'string' && m.audio_format === 'pcm_s16le' && m.sample_rate === 16000 && m.num_channels === 1;
        if (!ok) { send({ error_code: 400, error_type: 'invalid_request', error_message: 'bad config' }); st.closedBy = 'error'; setTimeout(() => ws.close(1011), lat + 5); }
        return;
      }
      if (m.type === 'keepalive') { st.keepalives++; return; }
      if (m.type === 'finalize') { st.finalizes++; emit(true, true); }
    });
    ws.on('close', () => { clearInterval(idle); if (st.closedBy === 'open') st.closedBy = 'client'; });
    ws.on('error', () => { /* terminated */ });
  }
}
