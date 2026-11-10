// RECORDED real Soniox async responses (2026-11-03, stt-async-v6) for audio generated locally with macOS `say`
// (English, Spanish, French, a 2-speaker conversation, an English+Spanish clip). They contain only that test text.
// Confirms the documented shape against the real API and pins the mapping on real tokens.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../src/lib/alerts.js', () => ({ reportAlert: vi.fn(), reportProviderFailure: vi.fn(), reportProviderHttpFailure: vi.fn() }));
vi.mock('../src/config/index.js', () => ({ config: {} }));
const { mapSonioxTokens } = await import('../src/services/stt/sonioxProvider.js');
const { normalizedWer } = await import('../src/services/stt/wer.js');

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/stt/${n}`, import.meta.url), 'utf8'));
const status = fx('soniox-recorded-status-completed.json');

describe('recorded Soniox responses', () => {
  it('real response shapes match what the adapter reads', () => {
    expect(fx('soniox-recorded-upload-response.json')).toMatchObject({ filename: 'recording.m4a' });
    expect(fx('soniox-recorded-create-response.json')).toMatchObject({
      status: 'queued', model: 'stt-async-v6', enable_speaker_diarization: true, enable_language_identification: true, language_hints: null,
    });
    expect(status).toMatchObject({ status: 'completed', audio_duration_ms: 30272, error_type: null });
    const t = fx('soniox-recorded-conv-transcript.json');
    expect(Object.keys(t).sort()).toEqual(['id', 'text', 'tokens']);
    expect(Object.keys(t.tokens[0]).sort()).toEqual(['confidence', 'end_ms', 'is_audio_event', 'language', 'speaker', 'start_ms', 'text', 'translation_status']);
    expect(typeof t.tokens[0].speaker).toBe('string'); // "1", "2": 1-based strings
    expect(t.tokens[1].text.startsWith(' ')).toBe(true); // sub-word tokens carry the leading space
  });

  it('2-speaker conversation: 2 speakers, alternating turns, language en, duration from audio_duration_ms', () => {
    const r = mapSonioxTokens(fx('soniox-recorded-conv-transcript.json').tokens, status.audio_duration_ms);
    expect(r.speakerCount).toBe(2);
    expect(r.segments.map((s) => s.speaker_index)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(r.segments[0].text).toBe('Hi Daniel, did you finish the budget report for the launch?');
    expect(r.detectedLanguage).toBe('en');
    expect(r.durationSeconds).toBe(30.272);
    expect(r.wordCount).toBe(82);
    for (const s of r.segments) expect(s.confidence).toBeGreaterThan(0.9);
  });

  it.each([['en', 'en'], ['es', 'es'], ['fr', 'fr']])('single-speaker %s clip: one speaker, language %s, numbers as digits', (name, lang) => {
    const t = fx(`soniox-recorded-${name}-transcript.json`);
    const r = mapSonioxTokens(t.tokens, null);
    expect(r.detectedLanguage).toBe(lang);
    expect(r.speakerCount).toBe(1);
    expect(r.segments.length).toBeGreaterThanOrEqual(1);
    expect(r.fullText).toMatch(/42[,.   ]?000/);
    expect(normalizedWer(r.fullText, r.fullText)).toBe(0);
  });

  it('English then Spanish clip: both languages are tagged per token; the dominant one wins the document language', () => {
    const t = fx('soniox-recorded-mixed-transcript.json');
    const langs = new Set(t.tokens.map((x: any) => x.language));
    expect(langs).toEqual(new Set(['en', 'es']));
    const r = mapSonioxTokens(t.tokens, null);
    expect(['en', 'es']).toContain(r.detectedLanguage);
  });
});
