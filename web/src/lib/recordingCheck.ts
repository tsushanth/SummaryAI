/**
 * Holds back a browser recording or an audio file that would only come back as "no speech", before it is uploaded. The
 * limits are the Android app's (service/RecordingCheck.kt): under 10 seconds, or never louder than 1% of full scale.
 * When silence or length cannot be judged reliably nothing is held back, or the user is offered "Upload anyway".
 *
 * No imports from the app: node loads this file directly in tests (scripts/recordingCheck.test.mjs).
 */

export const MIN_SECONDS = 10;
/** 1% of full scale (Android: 328 of 32767). A muted microphone and an empty room stay under it; speech is far above. */
export const SILENT_PEAK = 328 / 32767;
export const MIN_LEVEL_SAMPLES = 2;
/** "Silent" is only said when at least this share of the recording was listened to. */
export const MIN_LEVEL_COVERAGE = 0.5;

export type RecordingProblem = 'too_short' | 'silent';
export interface HeldRecording {
  problem: RecordingProblem;
  seconds: number;
  /** False only when the problem is certain. */
  canUploadAnyway: boolean;
}

/**
 * A recording made on this page. Its length comes from the recorder clock, so "too short" is certain; the level reading
 * can be wrong (a distant speaker, an unusual microphone), so a silent one can still be sent.
 * `peak` is 0..1, or null when it could not be judged.
 */
export function checkMicRecording(seconds: number, peak: number | null): HeldRecording | null {
  if (seconds < MIN_SECONDS) return { problem: 'too_short', seconds, canUploadAnyway: false };
  if (peak !== null && peak < SILENT_PEAK) return { problem: 'silent', seconds, canUploadAnyway: true };
  return null;
}

// ---- the microphone level while recording ----------------------------------------------------------------------------

/** The loudest sample heard, and how much of the recording was listened to. */
export class LevelMeter {
  private max = 0;
  private samples = 0;
  private coveredMs = 0;
  private lastAt: number | null = null;

  /** `window` holds the last `windowMs` of audio, read at time `now` (ms). */
  add(window: ArrayLike<number>, windowMs: number, now: number): void {
    for (let i = 0; i < window.length; i++) {
      const v = Math.abs(window[i]);
      if (v > this.max) this.max = v;
    }
    this.samples++;
    // Only what this read adds: windows overlap when reads are frequent, and leave gaps when a hidden tab slows timers.
    this.coveredMs += this.lastAt === null ? windowMs : Math.min(windowMs, Math.max(0, now - this.lastAt));
    this.lastAt = now;
  }

  /** The recorder is paused: the time until the next read is not part of the recording. */
  pause(): void {
    this.lastAt = null;
  }

  /** 0..1, or null when silence cannot be judged. Sound that was heard counts however little was listened to. */
  peak(recordedSeconds: number): number | null {
    if (this.max >= SILENT_PEAK) return this.max;
    if (this.samples < MIN_LEVEL_SAMPLES) return null;
    if (this.coveredMs < MIN_LEVEL_COVERAGE * recordedSeconds * 1000) return null;
    return this.max;
  }
}

export interface LevelContext {
  readonly state: string;
  readonly sampleRate: number;
  resume(): Promise<unknown>;
  close(): Promise<unknown>;
  createMediaStreamSource(stream: any): { connect(node: any): unknown; disconnect(): void };
  createAnalyser(): { fftSize: number; getFloatTimeDomainData(into: any): void };
}

export interface LevelSampling {
  /** One more read, for the last moment before Stop. */
  sampleNow(): void;
  stop(): void;
}

export const LEVEL_INTERVAL_MS = 250;
const NO_SAMPLING: LevelSampling = { sampleNow: () => {}, stop: () => {} };

/**
 * Reads the microphone level into `meter` while `isRecording()`. Reads nothing when the audio context is not running
 * (the browser did not let it start), which leaves the meter unable to judge rather than reporting silence.
 */
export function startLevelSampling(
  context: LevelContext | null,
  stream: unknown,
  meter: LevelMeter,
  isRecording: () => boolean,
  now: () => number = Date.now
): LevelSampling {
  if (!context) return NO_SAMPLING;
  const close = () => { context.close().catch(() => {}); };
  try {
    const analyser = context.createAnalyser();
    analyser.fftSize = 32768; // about 0.7 s, so slow timers still hear most of the recording
    // Held until stop(): a source node nobody refers to can be collected, after which the analyser hears nothing.
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);
    const windowMs = (analyser.fftSize / context.sampleRate) * 1000;
    context.resume().catch(() => {});
    const sampleNow = () => {
      try {
        if (!isRecording()) return meter.pause();
        if (context.state !== 'running') return;
        analyser.getFloatTimeDomainData(buffer);
        meter.add(buffer, windowMs, now());
      } catch {
        // a failed read only lowers what was listened to
      }
    };
    const timer = setInterval(sampleNow, LEVEL_INTERVAL_MS);
    let stopped = false;
    return {
      sampleNow: () => { if (!stopped) sampleNow(); },
      stop: () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        try { source.disconnect(); } catch { /* already gone */ }
        close();
      },
    };
  } catch {
    close();
    return NO_SAMPLING;
  }
}

// ---- a chosen audio file ---------------------------------------------------------------------------------------------

export interface FileAudio {
  /** Length in seconds, undefined when unknown. */
  seconds: number | undefined;
  /** True when the length comes from decoding the whole file; a length from its header can be wrong. */
  exact: boolean;
  /** 0..1, or null when it could not be judged. */
  peak: number | null;
}

export function checkAudioFile(audio: FileAudio): HeldRecording | null {
  const { seconds, exact, peak } = audio;
  if (seconds !== undefined && seconds < MIN_SECONDS) return { problem: 'too_short', seconds, canUploadAnyway: !exact };
  if (peak !== null && peak < SILENT_PEAK) return { problem: 'silent', seconds: seconds ?? 0, canUploadAnyway: true };
  return null;
}

export interface DecodedAudio {
  readonly duration: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): ArrayLike<number>;
}

/** The loudest sample, or the first one found that is not silence. */
export function peakOf(audio: DecodedAudio): number {
  let max = 0;
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > max) {
        max = v;
        if (max >= SILENT_PEAK) return max;
      }
    }
  }
  return max;
}

/** Decoding holds the whole file in memory, so long or large files are not judged. */
export const DECODE_MAX_BYTES = 50 * 1024 * 1024;
export const DECODE_MAX_SECONDS = 20 * 60;
export const DECODE_MAX_BYTES_UNKNOWN_LENGTH = 5 * 1024 * 1024;

export function canDecode(bytes: number, seconds: number | undefined): boolean {
  if (seconds === undefined) return bytes <= DECODE_MAX_BYTES_UNKNOWN_LENGTH;
  return bytes <= DECODE_MAX_BYTES && seconds <= DECODE_MAX_SECONDS;
}

export interface FileAudioDeps {
  /** Length from the file's metadata (lib/recordingDuration.ts). */
  readDuration(blob: Blob): Promise<number | undefined>;
  decode(data: ArrayBuffer): Promise<DecodedAudio>;
  timeoutMs?: number;
}

/** Never rejects: whatever cannot be read stays unknown, and unknown is never held back. */
export async function readFileAudio(blob: Blob, deps: FileAudioDeps): Promise<FileAudio> {
  const header = await deps.readDuration(blob).catch(() => undefined);
  const unknown: FileAudio = { seconds: header, exact: false, peak: null };
  if (!canDecode(blob.size, header)) return unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const decoded = await Promise.race([
      blob.arrayBuffer().then((data) => deps.decode(data)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('decode timeout')), deps.timeoutMs ?? 10_000); }),
    ]);
    // If the header promises a long file and decoding found a short one, the decoder may have stopped early.
    const partial = header !== undefined && header >= MIN_SECONDS && decoded.duration < MIN_SECONDS;
    return partial ? unknown : { seconds: decoded.duration, exact: true, peak: peakOf(decoded) };
  } catch {
    return unknown;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Decodes at a low sample rate to keep memory small. Throws where the browser cannot. */
export async function decodeInBrowser(data: ArrayBuffer): Promise<DecodedAudio> {
  const w = globalThis as any;
  const Offline = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  return new Offline(1, 1, 8000).decodeAudioData(data);
}

/** A context for the level meter, or null. Call it inside the click: some browsers only start audio from one. */
export function openAudioContext(): LevelContext | null {
  try {
    const w = globalThis as any;
    const Context = w.AudioContext ?? w.webkitAudioContext;
    return Context ? new Context() : null;
  } catch {
    return null;
  }
}

// ---- what the user reads ---------------------------------------------------------------------------------------------

export function recordingCheckText(
  held: HeldRecording,
  source: 'recording' | 'file',
  canKeepGoing = false
): { title: string; message: string } {
  if (source === 'file') {
    if (held.problem === 'silent') {
      return {
        title: 'We could not hear anything in that file',
        message: 'It was not uploaded. Check the file, or upload it anyway if you know there is speech in it.',
      };
    }
    return held.canUploadAnyway
      ? { title: 'That file looks very short', message: `It was not uploaded. If it is longer than ${MIN_SECONDS} seconds, upload it anyway.` }
      : { title: 'That file is very short', message: `Files under ${MIN_SECONDS} seconds are not uploaded. Choose a longer file.` };
  }
  const next = canKeepGoing ? 'Keep going to add to this one, or record again to replace it.' : 'Record again to replace it.';
  if (held.problem === 'too_short') {
    return { title: 'That was very short', message: `Recordings under ${MIN_SECONDS} seconds are not uploaded. ${next}` };
  }
  return {
    title: 'We could not hear anything',
    message: `Check that nothing covers the microphone and that it is not switched off. ${next} If you know there is speech in it, you can upload it anyway.`,
  };
}
