/**
 * Recording length helpers. The backend stores recordings.duration_seconds (INTEGER, > 0, capped by MAX_RECORDING_DURATION_SECONDS)
 * and every page shows it as the length. The web app used to send none, so the detail page read NULL and printed 0:00.
 *
 * No imports from the app: node loads this file directly in tests (scripts/recordingDuration.test.mjs).
 */

/** Same as the backend default for MAX_RECORDING_DURATION_SECONDS (4 h); a larger value would be rejected with a 400. */
export const MAX_DURATION_SECONDS = 14400;

/** A whole, positive, plausible number of seconds, or undefined (= do not send the field). */
export function sanitizeDurationSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  if (n < 1 || n > MAX_DURATION_SECONDS) return undefined;
  return n;
}

/** False for null / undefined / 0 / garbage: callers hide the length instead of printing 0:00. */
export function hasKnownDuration(seconds: number | null | undefined): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0;
}

/**
 * Active recording time, pauses excluded. The one-second UI ticker drifts and stops while paused; this is measured from
 * timestamps so the length sent to the backend matches what the user recorded.
 */
export class RecordingClock {
  private accumulatedMs = 0;
  private runningSince: number | null = null;

  start(now: number = Date.now()): void {
    this.accumulatedMs = 0;
    this.runningSince = now;
  }
  pause(now: number = Date.now()): void {
    this.stop(now);
  }
  resume(now: number = Date.now()): void {
    if (this.runningSince === null) this.runningSince = now;
  }
  stop(now: number = Date.now()): void {
    if (this.runningSince !== null) {
      this.accumulatedMs += Math.max(0, now - this.runningSince);
      this.runningSince = null;
    }
  }
  reset(): void {
    this.accumulatedMs = 0;
    this.runningSince = null;
  }
  seconds(now: number = Date.now()): number {
    const live = this.runningSince !== null ? Math.max(0, now - this.runningSince) : 0;
    return Math.round((this.accumulatedMs + live) / 1000);
  }
}

interface AudioLike {
  preload: string;
  src: string;
  readonly duration: number;
  currentTime: number;
  addEventListener(ev: string, fn: () => void): void;
  removeEventListener(ev: string, fn?: () => void): void;
  removeAttribute(name: string): void;
  load(): void;
}

export interface ReadDurationDeps {
  createAudio?: () => AudioLike;
  createObjectURL?: (b: Blob) => string;
  revokeObjectURL?: (u: string) => void;
  timeoutMs?: number;
}

/**
 * Length of an audio file/blob from its metadata, in whole seconds, or undefined when it cannot be read in time (best effort:
 * it must never block or fail an upload). MediaRecorder webm has no duration header, so browsers report Infinity until the
 * element is seeked far past the end; that is handled here.
 */
export function readAudioDuration(blob: Blob, deps: ReadDurationDeps = {}): Promise<number | undefined> {
  const timeoutMs = deps.timeoutMs ?? 4000;
  return new Promise((resolve) => {
    let url: string | null = null;
    let audio: AudioLike | null = null;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: number | undefined) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        audio?.removeEventListener('loadedmetadata', onMeta);
        audio?.removeEventListener('timeupdate', onSeeked);
        audio?.removeEventListener('error', onError);
        audio?.removeAttribute('src');
        audio?.load();
      } catch {
        // cleanup only
      }
      try {
        if (url) (deps.revokeObjectURL ?? URL.revokeObjectURL)(url);
      } catch {
        // cleanup only
      }
      resolve(value);
    };
    const onError = () => finish(undefined);
    const onSeeked = () => finish(sanitizeDurationSeconds(audio?.duration));
    const onMeta = () => {
      const d = audio?.duration;
      if (typeof d === 'number' && Number.isFinite(d)) return finish(sanitizeDurationSeconds(d));
      if (d === Infinity && audio) {
        audio.addEventListener('timeupdate', onSeeked);
        audio.currentTime = 1e101; // forces the browser to compute the real length
        return;
      }
      finish(undefined);
    };
    try {
      url = (deps.createObjectURL ?? URL.createObjectURL)(blob);
      audio = deps.createAudio ? deps.createAudio() : (new Audio() as unknown as AudioLike);
      audio.preload = 'metadata';
      audio.addEventListener('loadedmetadata', onMeta);
      audio.addEventListener('error', onError);
      timer = setTimeout(() => finish(undefined), timeoutMs);
      audio.src = url;
      audio.load();
    } catch {
      finish(undefined);
    }
  });
}
