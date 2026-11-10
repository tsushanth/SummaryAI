import type { SttConnectOptions, SttConnection, SttEngine, SttStreamHandlers } from './types.js';

/**
 * ElevenLabs realtime (Scribe) as the failover engine: INTERFACE ONLY in this skeleton.
 * Wire protocol: ElevenLabs realtime Scribe (committed_transcript / partial_transcript,
 * no diarization). To implement: map partial/committed messages to SttToken[] (isFinal=committed), word timings
 * to stream ms, no speaker labels (the mapper then falls back to speech events only), and add its own key (never share).
 * The session already handles everything around it (failover trigger, replay from the final watermark, epoch change).
 */
export class ElevenLabsEngine implements SttEngine {
  readonly name = 'elevenlabs';
  connect(_opts: SttConnectOptions, _handlers: SttStreamHandlers): Promise<SttConnection> {
    return Promise.reject(Object.assign(new Error('ElevenLabs realtime engine is not implemented yet'), {
      sttError: { code: null, type: 'not_implemented', retryable: false, fatal: true },
    }));
  }
}
