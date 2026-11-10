import type { SttConnectOptions, SttConnection, SttEngine, SttError, SttStreamHandlers, SttToken, SttUpdate } from '../../src/stt/types.js';

/** In-process engine for session unit tests: the test drives every server-side event by hand. */
export class FakeConn implements SttConnection {
  audio: Buffer[] = [];
  keepalives = 0;
  finalizes = 0;
  ended = false;
  closed = false;
  constructor(public readonly handlers: SttStreamHandlers, public readonly opts: SttConnectOptions) {}
  sendAudio(pcm: Buffer): void { this.audio.push(pcm); }
  keepalive(): void { this.keepalives++; }
  finalize(): void { this.finalizes++; }
  endStream(): void { this.ended = true; }
  close(): void { this.closed = true; }
  get bytes(): number { return this.audio.reduce((n, b) => n + b.length, 0); }
  emit(update: SttUpdate): void { this.handlers.onUpdate(update); }
  /** Convenience: one update with the given tokens and a final watermark. */
  say(tokens: SttToken[], finalAudioProcMs?: number): void {
    const maxFinal = tokens.filter((t) => t.isFinal).reduce((m, t) => Math.max(m, t.endMs), 0);
    this.emit({ tokens, finalAudioProcMs: finalAudioProcMs ?? maxFinal, totalAudioProcMs: Math.max(maxFinal, finalAudioProcMs ?? 0) });
  }
  drop(error?: SttError): void { this.handlers.onClose({ clean: !error, error }); }
}

export class FakeEngine implements SttEngine {
  conns: FakeConn[] = [];
  connectCalls = 0;
  /** Number of upcoming connect() calls that reject. */
  failConnects = 0;
  connectError: SttError | undefined;
  constructor(public readonly name = 'fake') {}
  async connect(opts: SttConnectOptions, handlers: SttStreamHandlers): Promise<SttConnection> {
    this.connectCalls++;
    if (this.failConnects > 0) {
      this.failConnects--;
      throw Object.assign(new Error('connect failed'), { sttError: this.connectError });
    }
    const c = new FakeConn(handlers, opts);
    this.conns.push(c);
    return c;
  }
  get last(): FakeConn { return this.conns[this.conns.length - 1]!; }
}

export const fin = (text: string, startMs: number, endMs: number, speaker = '1', language = 'en'): SttToken => ({ text, startMs, endMs, isFinal: true, speaker, language });
export const part = (text: string, startMs: number, endMs: number, speaker = '1'): SttToken => ({ text, startMs, endMs, isFinal: false, speaker, language: 'en' });
