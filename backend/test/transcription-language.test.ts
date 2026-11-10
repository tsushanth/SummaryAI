import { describe, it, expect } from 'vitest';
import {
  AUTO_LANGUAGE,
  TRANSCRIPTION_LANGUAGES,
  normalizeTranscriptionLanguage,
  TranscriptionLanguageSchema,
  storedLanguageOrAuto,
  recallTranscriptProvider,
  deepgramLanguageParam,
  sonioxLanguageHints,
  languageFromText,
} from '../src/lib/transcriptionLanguage.js';

// Recall recallai_streaming accuracy-mode list and Soniox list, copied from their docs on 2026-11-03 (see backend/LIVE_STT.md).
const RECALL = 'bg ca cs da de el en es et fi fr he hi hr hu id it ja ko lt lv ms nl no pl pt ro ru sk sv th tr uk vi zh'.split(' ');
const SONIOX = 'af sq ar az eu be bn bs bg ca zh hr cs da nl en et fi fr gl de el gu he hi hu id it ja kn kk ko lv lt mk ms ml mr no fa pl pt pa ro ru sr sk sl es sw sv tl ta te th tr uk ur vi cy'.split(' ');
const NOVA2_MISSING = ['he', 'hr'];

describe('allow-list', () => {
  it('is exactly the languages BOTH Recall and Soniox support', () => {
    const both = RECALL.filter((c) => SONIOX.includes(c)).sort();
    expect(TRANSCRIPTION_LANGUAGES.map((l) => l.code).sort()).toEqual(both);
    expect(both).toHaveLength(35);
  });
  it('has English and native names, no duplicates, lowercase 2-letter codes', () => {
    const codes = TRANSCRIPTION_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const l of TRANSCRIPTION_LANGUAGES) {
      expect(l.code).toMatch(/^[a-z]{2}$/);
      expect(l.name.length).toBeGreaterThan(1);
      expect(l.native.length).toBeGreaterThan(1);
    }
    expect(TRANSCRIPTION_LANGUAGES.find((l) => l.code === 'es')!.native).toBe('Español');
  });
  it('marks the two languages Deepgram nova-2 lacks', () => {
    expect(TRANSCRIPTION_LANGUAGES.filter((l) => !l.deepgramNova2).map((l) => l.code).sort()).toEqual(NOVA2_MISSING);
  });
});

describe('normalizeTranscriptionLanguage', () => {
  it('accepts auto, codes, case and region/underscore variants', () => {
    expect(normalizeTranscriptionLanguage('auto')).toBe('auto');
    expect(normalizeTranscriptionLanguage('FR')).toBe('fr');
    expect(normalizeTranscriptionLanguage(' es-MX ')).toBe('es');
    expect(normalizeTranscriptionLanguage('pt_BR')).toBe('pt');
    expect(normalizeTranscriptionLanguage('zh-Hant-TW')).toBe('zh');
  });
  it('maps the legacy Java/Android codes and Norwegian variants', () => {
    expect(normalizeTranscriptionLanguage('iw')).toBe('he');
    expect(normalizeTranscriptionLanguage('in')).toBe('id');
    expect(normalizeTranscriptionLanguage('nb')).toBe('no');
    expect(normalizeTranscriptionLanguage('nn-NO')).toBe('no');
  });
  it('rejects anything else (including languages only one provider supports)', () => {
    for (const bad of ['', 'xx', 'ar', 'ta', 'eng', 'en us', 'fr;drop', '1', 'multi', null, undefined, 5, {}, 'a'.repeat(40)]) {
      expect(normalizeTranscriptionLanguage(bad as unknown)).toBeNull();
    }
  });
});

describe('TranscriptionLanguageSchema', () => {
  it('parses to the normalized code and fails on unknown codes', () => {
    expect(TranscriptionLanguageSchema.parse('DE-ch')).toBe('de');
    expect(TranscriptionLanguageSchema.safeParse('klingon').success).toBe(false);
    expect(TranscriptionLanguageSchema.safeParse(3).success).toBe(false);
    expect(TranscriptionLanguageSchema.optional().parse(undefined)).toBeUndefined();
  });
});

describe('storedLanguageOrAuto', () => {
  it('reads a stored value defensively', () => {
    expect(storedLanguageOrAuto(null)).toBe('auto');
    expect(storedLanguageOrAuto(undefined)).toBe('auto');
    expect(storedLanguageOrAuto('fr')).toBe('fr');
    expect(storedLanguageOrAuto('zz')).toBe('auto');
  });
});

describe('recallTranscriptProvider', () => {
  it('nothing chosen, auto and en keep today\'s block exactly (low latency en when realtime)', () => {
    for (const l of [undefined, 'auto', 'en', null]) {
      expect(recallTranscriptProvider(l, true)).toEqual({ mode: 'prioritize_low_latency', language_code: 'en' });
      expect(recallTranscriptProvider(l, false)).toEqual({ mode: 'prioritize_accuracy', language_code: 'en' });
    }
  });
  it('every other language needs accuracy mode (Recall: low latency is English only)', () => {
    for (const l of TRANSCRIPTION_LANGUAGES.filter((x) => x.code !== 'en')) {
      expect(recallTranscriptProvider(l.code, true)).toEqual({ mode: 'prioritize_accuracy', language_code: l.code });
      expect(recallTranscriptProvider(l.code, false)).toEqual({ mode: 'prioritize_accuracy', language_code: l.code });
    }
  });
  it('auto uses Recall language detection only when the opt-in flag is on', () => {
    expect(recallTranscriptProvider('auto', true, { autoDetect: true })).toEqual({ mode: 'prioritize_accuracy', language_code: 'auto' });
    expect(recallTranscriptProvider(undefined, true, { autoDetect: true })).toEqual({ mode: 'prioritize_accuracy', language_code: 'auto' });
    expect(recallTranscriptProvider('en', true, { autoDetect: true })).toEqual({ mode: 'prioritize_low_latency', language_code: 'en' });
  });
});

describe('deepgramLanguageParam', () => {
  it('detects for auto/none/nova-2-unsupported, pins otherwise', () => {
    expect(deepgramLanguageParam(undefined)).toBeNull();
    expect(deepgramLanguageParam('auto')).toBeNull();
    expect(deepgramLanguageParam('he')).toBeNull();
    expect(deepgramLanguageParam('hr')).toBeNull();
    expect(deepgramLanguageParam('fr')).toBe('fr');
    expect(deepgramLanguageParam('zh')).toBe('zh');
    expect(deepgramLanguageParam('not-a-code')).toBeNull();
  });
});

describe('sonioxLanguageHints', () => {
  it('no hints for auto/none/unknown, one hint otherwise', () => {
    expect(sonioxLanguageHints(undefined)).toEqual([]);
    expect(sonioxLanguageHints('auto')).toEqual([]);
    expect(sonioxLanguageHints('zz')).toEqual([]);
    expect(sonioxLanguageHints('es')).toEqual(['es']);
  });
});

describe('languageFromText (stitched fallback, best effort)', () => {
  it('detects by script and by stop words, defaults to en', () => {
    expect(languageFromText('これは日本語のテストです。ありがとうございます')).toBe('ja');
    expect(languageFromText('안녕하세요 오늘 회의를 시작하겠습니다')).toBe('ko');
    expect(languageFromText('Привет всем, давайте начнем встречу сегодня')).toBe('ru');
    expect(languageFromText('今天我们讨论一下下个季度的计划')).toBe('zh');
    expect(languageFromText('Hola a todos, vamos a empezar la reunión porque tenemos que hablar de los planes para el próximo mes')).toBe('es');
    expect(languageFromText('Bonjour à tous, nous allons commencer la réunion parce que nous avons des choses à discuter dans les plans')).toBe('fr');
    expect(languageFromText('Guten Tag zusammen, wir werden die Besprechung beginnen, weil wir über die Pläne sprechen müssen und nicht warten')).toBe('de');
    expect(languageFromText('Hello everyone, let us start the meeting because we have the plans to discuss')).toBe('en');
    expect(languageFromText('')).toBe('en');
    expect(languageFromText('ok')).toBe('en');
  });
});
