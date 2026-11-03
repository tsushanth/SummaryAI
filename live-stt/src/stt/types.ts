/** Engine-neutral streaming STT contract. Soniox implements it; ElevenLabs realtime can be added behind the same shape. */

export interface SttToken {
  text: string;
  /** Milliseconds on the STREAM clock (0 = first audio byte sent on this stream). */
  startMs: number;
  endMs: number;
  isFinal: boolean;
  speaker?: string;
  language?: string;
  confidence?: number;
  /** Soniox control tokens: `<end>` (endpoint detected) and `<fin>` (our finalize request completed). text is empty. */
  control?: 'end' | 'fin';
}

export interface SttUpdate {
  tokens: SttToken[];
  /** Everything before this stream-ms is final (vendor statement). */
  finalAudioProcMs?: number;
  totalAudioProcMs?: number;
  finished?: boolean;
}

export interface SttError {
  code: number | null;
  type: string;
  retryable: boolean;
  /** Retrying cannot help (bad key, no credit, bad model): switch engine or degrade. */
  fatal: boolean;
  rateLimited?: boolean;
  maxDuration?: boolean;
}

export interface SttCloseInfo {
  clean: boolean;
  error?: SttError;
}

export interface SttStreamHandlers {
  onUpdate(u: SttUpdate): void;
  onClose(info: SttCloseInfo): void;
}

export interface SttConnectOptions {
  /** Context terms (meeting title, participant names, product words). */
  terms: string[];
  languageHints: string[];
  diarization: boolean;
}

export interface SttConnection {
  /** 16 kHz mono s16le PCM. May throw if the socket is gone: the caller treats that as a drop. */
  sendAudio(pcm: Buffer): void;
  keepalive(): void;
  /** Force pending tokens final. */
  finalize(): void;
  /** Graceful end of stream: the server flushes and answers `finished`. */
  endStream(): void;
  /** Hard close. */
  close(): void;
}

export interface SttEngine {
  readonly name: string;
  /** Resolves once the stream is ready to take audio. Rejects (optionally with `.sttError`) if it cannot connect. */
  connect(opts: SttConnectOptions, handlers: SttStreamHandlers): Promise<SttConnection>;
}
