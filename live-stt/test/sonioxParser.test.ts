import { describe, expect, it } from 'vitest';
import { buildSonioxConfig, parseSonioxMessage } from '../src/stt/soniox.js';

describe('buildSonioxConfig', () => {
  it('builds the documented realtime config for 16 kHz s16le mono with diarization and language id', () => {
    const c = buildSonioxConfig({ model: 'stt-rt-v6', terms: ['Kreative Koala', 'MeetingMind'], languageHints: ['en', 'es'], apiKey: undefined });
    expect(c).toEqual({
      model: 'stt-rt-v6',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      enable_speaker_diarization: true,
      enable_language_identification: true,
      enable_endpoint_detection: false,
      language_hints: ['en', 'es'],
      context: { terms: ['Kreative Koala', 'MeetingMind'] },
    });
  });
  it('omits context/hints when empty and only includes api_key when asked (deprecated in-frame auth)', () => {
    const c = buildSonioxConfig({ model: 'm', terms: [], languageHints: [], apiKey: 'k' });
    expect(c).not.toHaveProperty('context');
    expect(c).not.toHaveProperty('language_hints');
    expect(c.api_key).toBe('k');
  });
  it('caps context terms to a sane count', () => {
    const terms = Array.from({ length: 500 }, (_, i) => `term${i}`);
    const c = buildSonioxConfig({ model: 'm', terms, languageHints: [] });
    expect((c.context as { terms: string[] }).terms.length).toBeLessThanOrEqual(200);
  });
});

describe('parseSonioxMessage', () => {
  it('parses tokens with speaker, language and processed-audio watermarks', () => {
    const r = parseSonioxMessage(JSON.stringify({
      tokens: [
        { text: 'Hello', start_ms: 600, end_ms: 760, confidence: 0.97, is_final: true, speaker: '1', language: 'en' },
        { text: ' wor', start_ms: 800, end_ms: 900, confidence: 0.5, is_final: false, speaker: '1', language: 'en' },
      ],
      final_audio_proc_ms: 760,
      total_audio_proc_ms: 900,
    }));
    expect(r.type).toBe('update');
    if (r.type !== 'update') return;
    expect(r.update.finalAudioProcMs).toBe(760);
    expect(r.update.totalAudioProcMs).toBe(900);
    expect(r.update.tokens).toEqual([
      { text: 'Hello', startMs: 600, endMs: 760, isFinal: true, speaker: '1', language: 'en', confidence: 0.97 },
      { text: ' wor', startMs: 800, endMs: 900, isFinal: false, speaker: '1', language: 'en', confidence: 0.5 },
    ]);
  });
  it('turns <fin>/<end> into control tokens with empty text (real API emits them as final tokens)', () => {
    const r = parseSonioxMessage(JSON.stringify({ tokens: [{ text: '<fin>', is_final: true }, { text: '<end>', is_final: true }], final_audio_proc_ms: 5 }));
    expect(r.type === 'update' && r.update.tokens.map((t) => [t.text, t.control])).toEqual([['', 'fin'], ['', 'end']]);
  });
  it('builds endpoint detection config with max_endpoint_delay_ms', () => {
    const c = buildSonioxConfig({ model: 'm', endpointDetection: true, endpointMaxDelayMs: 1000 });
    expect(c.enable_endpoint_detection).toBe(true);
    expect(c.max_endpoint_delay_ms).toBe(1000);
  });
  it('parses the finished message', () => {
    const r = parseSonioxMessage(JSON.stringify({ tokens: [], final_audio_proc_ms: 100, total_audio_proc_ms: 100, finished: true }));
    expect(r.type === 'update' && r.update.finished).toBe(true);
  });
  it('classifies errors by error_type/code, never copying the message text', () => {
    const e = (code: number, type?: string) => parseSonioxMessage(JSON.stringify({ error_code: code, error_type: type, error_message: 'secret transcript text sk-123' }));
    const r429 = e(429);
    expect(r429).toMatchObject({ type: 'error', error: { code: 429, retryable: true, rateLimited: true, fatal: false } });
    expect(e(401)).toMatchObject({ type: 'error', error: { fatal: true, retryable: false } });
    expect(e(402)).toMatchObject({ type: 'error', error: { fatal: true } });
    expect(e(400, 'model_not_available')).toMatchObject({ type: 'error', error: { fatal: true } });
    expect(e(408, 'request_timeout')).toMatchObject({ type: 'error', error: { retryable: true, fatal: false } });
    expect(e(413, 'max_duration_reached')).toMatchObject({ type: 'error', error: { retryable: true, maxDuration: true } });
    expect(e(503, 'service_unavailable')).toMatchObject({ type: 'error', error: { retryable: true } });
    expect(JSON.stringify(r429)).not.toContain('sk-123');
  });
  it('returns ignore for non-JSON or unknown shapes', () => {
    expect(parseSonioxMessage('nope').type).toBe('ignore');
    expect(parseSonioxMessage('{}').type).toBe('ignore');
  });
});
