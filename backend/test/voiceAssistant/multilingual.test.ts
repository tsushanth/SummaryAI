/**
 * Multilingual assistant (MEETING_ASSISTANT_MULTILINGUAL). Pure helpers, the speech provider client (fake fetch), the session with the
 * flag on and off, the createBot plan and the live-stt manager path. Everything is deterministic: fake clock, fake fetch, no network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../../src/services/recallService.js', () => ({ RecallService: {} }));
vi.mock('../../src/config/index.js', () => ({ config: { SUMMARY_MODEL: 'claude-haiku-4-5-20251001' } }));
vi.mock('../../src/lib/llm.js', () => ({ instrumentAnthropic: (c: any) => c, withFeature: (_n: string, fn: any) => fn() }));

import { makeWorld, answerOf, fakeMp3, OWNER } from './world.js';
import { loadVoiceAssistantConfig, NUMBER_NORMALIZE_DEFAULTS } from '../../src/services/voiceAssistant/config.js';
import { VoiceSession } from '../../src/services/voiceAssistant/session.js';
import { VoiceAssistantManager, type ManagerDeps } from '../../src/services/voiceAssistant/manager.js';
import { VoiceMetrics } from '../../src/services/voiceAssistant/metrics.js';
import { detectWakeMulti, isEchoOfMulti, isStopRequestMulti, isStopWordMulti } from '../../src/services/voiceAssistant/wakeMulti.js';
import { detectWake, isEchoOf } from '../../src/services/voiceAssistant/wake.js';
import { decideLanguage, digitSafeText, LanguageTracker, ruNumberWords, spellNumbersRu, stripWakePhraseFor, supportedLanguages, unsupportedLanguageText, voiceFor } from '../../src/services/voiceAssistant/languages.js';
import { selectTtsProvider, createSynthesizer } from '../../src/services/voiceAssistant/tts.js';
import {
  CHUNK_CHARS, CREDIT_BLOCK_MS, MAX_CONCURRENT, TtsError, getReadAloudStats, readAloudAvailable, resetReadAloudBreaker, resetReadAloudStats,
  splitForSpeech, synthesizeReadAloud,
} from '../../src/services/voiceAssistant/readaloudTts.js';
import { buildSystemPrompt, createAnswerer } from '../../src/services/voiceAssistant/agent.js';
import { planVoiceAssistant } from '../../src/services/voiceAssistant/recallIntegration.js';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  resetReadAloudBreaker();
  resetReadAloudStats();
});

const ML = { MEETING_ASSISTANT_MULTILINGUAL: '1' };
const cfgOf = (env: Record<string, string> = {}) => loadVoiceAssistantConfig({ VOICE_ASSISTANT_MODE: 'all', ...env } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------------------------------------------------------------
describe('config', () => {
  it('flag defaults OFF, Russian is the only default language, normalisation policy is the measured one', () => {
    const c = cfgOf();
    expect(c.multilingual).toBe(false);
    expect(c.languages).toEqual(['ru']);
    expect(NUMBER_NORMALIZE_DEFAULTS).toMatchObject({ de: 'numbers', fr: 'numbers', it: 'numbers', es: 'numbers', en: 'none', ja: 'none', ru: 'none', pt: 'none' });
    expect(cfgOf({ MEETING_ASSISTANT_TTS_NORMALIZE: 'ru=numbers' }).numberNormalize.ru).toBe('numbers'); // an explicit override is honoured
    expect(cfgOf(ML).multilingual).toBe(true);
    expect(cfgOf({ MEETING_ASSISTANT_LANGUAGES: 'ru, DE-de ,en,x1' }).languages).toEqual(['ru', 'de']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('wake phrase in Russian', () => {
  const cfg = cfgOf(ML);
  it.each([
    ['Митинг майнд, что мы решили по дате запуска?', 'что мы решили по дате запуска?'],
    ['митинг майнд что мы решили', 'что мы решили'],
    ['Привет, Митинг Майнд, подведи итоги встречи', 'подведи итоги встречи'],
    ['Ну митинг-майнд скажи кто за это отвечает', 'скажи кто за это отвечает'],
    ['Мит инг, что у нас с бюджетом', 'что у нас с бюджетом'],
    ['Митинг майнд', ''],
  ])('wakes: %s', (text, q) => {
    expect(detectWakeMulti(text, cfg)).toEqual({ question: q });
  });

  it.each([
    'Митинг',
    'Митинг в пятницу перенесли на вечер',
    'Давайте проведём митинг завтра утром',
    'Вчера был большой митинг на площади',
    'Я думаю, митинг майнд это хорошее название',
    'Мы обсуждали майнд карту проекта',
    '',
  ])('does not wake: %s', (text) => {
    expect(detectWakeMulti(text, cfg)).toBeNull();
  });

  it('the English phrase still works anywhere, exactly as wake.ts decides, and English text never reaches the new code', () => {
    expect(detectWakeMulti('Meeting Mind, what did we decide?', cfg)).toEqual(detectWake('Meeting Mind, what did we decide?'));
    expect(detectWakeMulti('we should ask Meeting Mind about it', cfg)).toBeNull();
    expect(detectWakeMulti('Hey meeting mined, summarize the discussion so far please', cfg)).toEqual(detectWake('Hey meeting mined, summarize the discussion so far please'));
  });

  it('a language that is not switched on does not wake', () => {
    expect(detectWakeMulti('Митинг майнд, что мы решили', cfgOf({ ...ML, MEETING_ASSISTANT_LANGUAGES: '' }))).toBeNull();
  });

  it('operator-supplied extra phrases work, malformed JSON is ignored', () => {
    const c = cfgOf({ ...ML, MEETING_ASSISTANT_WAKE_PHRASES: '{"ru":["эй помощник"]}' });
    expect(detectWakeMulti('Эй помощник, что мы решили', c)).toEqual({ question: 'что мы решили' });
    expect(detectWakeMulti('Митинг майнд, что мы решили', cfgOf({ ...ML, MEETING_ASSISTANT_WAKE_PHRASES: '{oops' }))).toEqual({ question: 'что мы решили' });
  });
});

describe('stop words in Russian', () => {
  const cfg = cfgOf(ML);
  it('word edges are Unicode aware', () => {
    expect(isStopWordMulti('стоп', cfg)).toBe(true);
    expect(isStopWordMulti('Хватит, достаточно', cfg)).toBe(true);
    expect(isStopWordMulti('остановка автобуса', cfg)).toBe(false);
    expect(isStopWordMulti('постоянно', cfg)).toBe(false); // contains "стоп"-like letters inside a word? no: "постоянно" has "сто" only
    expect(isStopWordMulti('столовая закрыта', cfg)).toBe(false);
    expect(isStopWordMulti('please stop', cfg)).toBe(true); // English stays
  });
  it('a bare stop is not a question; a question containing one is', () => {
    expect(isStopRequestMulti('Митинг майнд, отмена', cfg)).toBe(true);
    expect(isStopRequestMulti('стоп', cfg)).toBe(true);
    expect(isStopRequestMulti('Что мы решили, прежде чем остановить проект на этой неделе', cfg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('echo guard', () => {
  const spoken = 'Вы решили запускать продукт в пятницу, а бюджет утвердили на следующей неделе.';
  it('hears the bot own Russian answer back (exact, with a dropped word, with different endings)', () => {
    expect(isEchoOfMulti(spoken, spoken)).toBe(true);
    expect(isEchoOfMulti('вы решили запускать продукт в пятницу а бюджет утвердили', spoken)).toBe(true);
    expect(isEchoOfMulti('вы решили запускать продукты в пятницу бюджет утвердили на следующей неделе', spoken)).toBe(true);
  });
  it('a Latin transliteration of the Russian answer is also an echo (the speech-to-text may write it either way)', () => {
    expect(isEchoOfMulti('vy reshili zapuskat produkt v pyatnitsu', 'Вы решили запускать продукт в пятницу')).toBe(true);
  });
  it('a different Russian sentence is not an echo, short text is never one', () => {
    expect(isEchoOfMulti('Давайте перенесём встречу на понедельник утром', spoken)).toBe(false);
    expect(isEchoOfMulti('в пятницу', spoken)).toBe(false);
  });
  it('the bot own cue does not wake it, even though it is not a wake phrase anyway; English echo behaves as before', () => {
    expect(isEchoOfMulti('Let me check.', 'Let me check.')).toBe(isEchoOf('Let me check.', 'Let me check.')); // Latin on both sides: the original function decides
    expect(isEchoOfMulti('you decided to ship on friday', 'You decided to ship on Friday.')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('language decision', () => {
  it('Cyrillic text decides by itself', () => {
    expect(decideLanguage({ text: 'что мы решили насчёт даты запуска' })).toMatchObject({ code: 'ru', confident: true });
    expect(decideLanguage({ text: 'що ми вирішили щодо дати запуску' })).toMatchObject({ code: 'uk', confident: true });
  });
  it('short ambiguous Cyrillic is not confident unless a tag or the meeting agrees', () => {
    expect(decideLanguage({ text: 'что там' }).confident).toBe(false);
    expect(decideLanguage({ text: 'что там', tag: 'ru' })).toMatchObject({ code: 'ru', confident: true });
    expect(decideLanguage({ text: 'что там', configured: 'ru' })).toMatchObject({ code: 'ru', confident: true });
  });
  it('Latin text is English unless the meeting dominantly agrees on another language; a lone mis-tag never wins', () => {
    expect(decideLanguage({ text: 'what did we decide about pricing' })).toMatchObject({ code: 'en', confident: true });
    expect(decideLanguage({ text: 'what did we decide about pricing', tag: 'de' })).toMatchObject({ code: 'en' });
    expect(decideLanguage({ text: 'was haben wir beschlossen', tag: 'de', dominant: 'de' })).toMatchObject({ code: 'de' });
  });
  it('the wake phrase alone leans on the meeting; with nothing to go on it is English', () => {
    expect(decideLanguage({ text: '', tag: 'ru', dominant: 'ru' })).toMatchObject({ code: 'ru', confident: true });
    expect(decideLanguage({ text: '' })).toMatchObject({ code: 'en', confident: true });
    expect(decideLanguage({ text: '', tag: 'ru' }).confident).toBe(false);
  });
  it('tracker: rolling vote needs samples and a clear majority', () => {
    const t = new LanguageTracker();
    t.observe('ru'); t.observe('ru');
    expect(t.dominant()).toBeNull();
    t.observe('ru-RU');
    expect(t.dominant()).toBe('ru');
    const mixed = new LanguageTracker();
    for (const x of ['ru', 'en', 'ru', 'en', 'de']) mixed.observe(x);
    expect(mixed.dominant()).toBeNull();
    mixed.observe(null); mixed.observe('auto');
    expect(mixed.dominant()).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('digit post-check and Russian numbers', () => {
  it('number words', () => {
    expect(ruNumberWords(0)).toBe('ноль');
    expect(ruNumberWords(21)).toBe('двадцать один');
    expect(ruNumberWords(2000)).toBe('две тысячи');
    expect(ruNumberWords(1_250_000)).toBe('один миллион двести пятьдесят тысяч');
  });
  it('dates, times, percent, currency, decimals', () => {
    expect(spellNumbersRu('23 ноября')).toBe('двадцать третье ноября');
    expect(spellNumbersRu('в 14:30')).toBe('в четырнадцать тридцать');
    expect(spellNumbersRu('в 9:05')).toBe('в девять ноль пять');
    expect(spellNumbersRu('21%')).toBe('двадцать один процент');
    expect(spellNumbersRu('5 %')).toBe('пять процентов');
    expect(spellNumbersRu('$100')).toBe('сто долларов');
    expect(spellNumbersRu('50€')).toBe('пятьдесят евро');
    expect(spellNumbersRu('3,5 часа')).toBe('три запятая пять часа');
    expect(spellNumbersRu('1 200 человек')).toBe('одна тысяча двести человек');
  });
  it('no digit ever survives for a language whose policy is not "numbers"', () => {
    const c = cfgOf(ML);
    const out = digitSafeText('Бюджет 12 500 на 3 квартала, код 4815162342, версия 2.0', 'ru', c);
    expect(out).not.toMatch(/\d/);
  });
  it('a language with no number rule has digit runs removed; a "numbers" language is left to the provider; English untouched', () => {
    const c = cfgOf(ML);
    expect(digitSafeText('Es sind 12 Leute', 'xx', c)).toBe('Es sind Leute');
    expect(digitSafeText('Es sind 12 Leute', 'de', c)).toBe('Es sind 12 Leute');
    expect(digitSafeText('There are 12 people', 'en', c)).toBe('There are 12 people');
  });
  it('the bot own wake phrase is removed from what it will say, so it cannot wake itself', () => {
    const t = stripWakePhraseFor('Скажите Митинг Майнд и задайте вопрос', 'ru');
    expect(detectWakeMulti(t, cfgOf(ML))).toBeNull();
    expect(t).not.toMatch(/Митинг/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('provider selection', () => {
  it('flag off: always the configured English provider, whatever the language', () => {
    expect(selectTtsProvider(cfgOf(), 'ru')).toBe('deepgram');
    expect(selectTtsProvider(cfgOf({ VOICE_ASSISTANT_TTS_PROVIDER: 'openai' }), 'ru')).toBe('openai');
  });
  it('flag on: English (or no language) stays on the English provider, everything else goes to the multilingual one', () => {
    const c = cfgOf(ML);
    expect(selectTtsProvider(c)).toBe('deepgram');
    expect(selectTtsProvider(c, 'en')).toBe('deepgram');
    expect(selectTtsProvider(c, 'ru')).toBe('readaloud');
  });
  it('voices: built-in default, operator override, unknown language has none', () => {
    expect(voiceFor(cfgOf(), 'ru')).toBe('aria');
    expect(voiceFor(cfgOf({ MEETING_ASSISTANT_TTS_VOICES: 'ru=kai' }), 'ru')).toBe('kai');
    expect(voiceFor(cfgOf(), 'xx')).toBeNull();
    expect(supportedLanguages(cfgOf({ MEETING_ASSISTANT_LANGUAGES: 'ru,xx' }))).toEqual(['ru']);
    expect(unsupportedLanguageText(cfgOf())).toBe('Sorry, I can only answer in English and Russian for now.');
  });
  it('the synthesizer sends English to the English endpoint and Russian to the speech provider with the right request', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchFn = (async (url: string, init: any) => { calls.push({ url, init }); return new Response(fakeMp3(20), { status: 200 }); }) as unknown as typeof fetch;
    const synth = createSynthesizer(() => cfgOf({ ...ML, DEEPGRAM_API_KEY: 'dg' }), fetchFn, { getKey: () => 'rk-test', getBaseUrl: () => 'https://tts.example' });
    const r = await synth('Вы решили запускать продукт в пятницу.', 'ru');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://tts.example/v1/text-to-speech/aria?output_format=mp3_44100_128');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer rk-test');
    const body = JSON.parse(calls[0]!.init.body);
    expect(body).toEqual({ text: 'Вы решили запускать продукт в пятницу.', language_code: 'ru' }); // ru: never normalize
    expect(r.usd).toBeCloseTo((r.chars / 1000) * 0.01, 8);
    expect(r.seconds).toBeGreaterThan(0.4);
  });
  it('normalize:"numbers" is sent for de/fr/it/es only', async () => {
    const bodies: any[] = [];
    const fetchFn = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(fakeMp3(20), { status: 200 }); }) as unknown as typeof fetch;
    const c = cfgOf({ ...ML, MEETING_ASSISTANT_LANGUAGES: 'ru,de,en,ja,pt', MEETING_ASSISTANT_TTS_VOICES: 'de=a,ja=b,pt=c' });
    const synth = createSynthesizer(() => c, fetchFn, { getKey: () => 'k' });
    for (const l of ['de', 'ru', 'ja', 'pt']) await synth('Kurzer Text hier.', l);
    expect(bodies.map((b) => b.normalize)).toEqual(['numbers', undefined, undefined, undefined]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('speech provider client', () => {
  const ok = () => new Response(fakeMp3(20), { status: 200 });
  const noSleep = async () => {};

  it('splits at sentence edges into pieces of at most 170 characters', () => {
    const sentence = 'Это довольно длинное предложение, которое нужно произнести целиком. ';
    const text = sentence.repeat(12);
    const pieces = splitForSpeech(text);
    expect(pieces.length).toBeGreaterThan(3);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(text.trim().replace(/\s+/g, ' '));
    expect(splitForSpeech('x'.repeat(400)).every((p) => p.length <= CHUNK_CHARS)).toBe(true);
    expect(splitForSpeech('   ')).toEqual([]);
  });

  it('at most 2 requests in flight, answers joined in order', async () => {
    let inFlight = 0, peak = 0;
    const fetchFn = (async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return ok();
    }) as unknown as typeof fetch;
    const text = 'Первое предложение идёт здесь и оно достаточно длинное для отдельного куска речи, чтобы проверить разбиение. '.repeat(8);
    const r = await synthesizeReadAloud({ text, voice: 'aria', language: 'ru' }, { fetchFn, getKey: () => 'k', sleep: noSleep });
    expect(r.pieces).toBeGreaterThanOrEqual(5);
    expect(peak).toBe(MAX_CONCURRENT);
    expect(r.audio.length).toBeGreaterThan(417 * 20);
  });

  it('the limit is shared by concurrent answers, not per answer', async () => {
    let inFlight = 0, peak = 0;
    const fetchFn = (async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 10)); inFlight--; return ok(); }) as unknown as typeof fetch;
    const deps = { fetchFn, getKey: () => 'k', sleep: noSleep };
    const text = 'Фраза номер один достаточно длинная. '.repeat(15);
    await Promise.all([1, 2, 3].map(() => synthesizeReadAloud({ text, voice: 'aria', language: 'ru' }, deps)));
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT);
  });

  it('502 and 503 are retried once, then succeed', async () => {
    for (const status of [502, 503]) {
      let n = 0;
      const fetchFn = (async () => (n++ === 0 ? new Response('busy', { status }) : ok())) as unknown as typeof fetch;
      const r = await synthesizeReadAloud({ text: 'Привет, как дела у вас сегодня.', voice: 'aria', language: 'ru' }, { fetchFn, getKey: () => 'k', sleep: noSleep });
      expect(n).toBe(2);
      expect(r.pieces).toBe(1);
    }
    expect(getReadAloudStats().retries).toBe(2);
  });

  it('a second 503 in a row fails as an upstream error (no third try)', async () => {
    let n = 0;
    const fetchFn = (async () => { n++; return new Response('busy', { status: 503 }); }) as unknown as typeof fetch;
    await expect(synthesizeReadAloud({ text: 'Привет, как дела у вас сегодня.', voice: 'aria', language: 'ru' }, { fetchFn, getKey: () => 'k', sleep: noSleep }))
      .rejects.toMatchObject({ kind: 'upstream' });
    expect(n).toBe(2);
  });

  it('402 = no credits: typed error, and the provider is not called again for 10 minutes', async () => {
    let n = 0;
    let t = 1_000_000;
    const fetchFn = (async () => { n++; return new Response('payment required', { status: 402 }); }) as unknown as typeof fetch;
    const deps = { fetchFn, getKey: () => 'k', sleep: noSleep, now: () => t };
    const req = { text: 'Привет, как дела у вас сегодня.', voice: 'aria', language: 'ru' };
    await expect(synthesizeReadAloud(req, deps)).rejects.toMatchObject({ kind: 'no_credits', status: 402 });
    expect(readAloudAvailable({ getKey: () => 'k', now: () => t })).toBe(false);
    await expect(synthesizeReadAloud(req, deps)).rejects.toMatchObject({ kind: 'no_credits' });
    expect(n).toBe(1); // the second question never reached the network
    t += CREDIT_BLOCK_MS + 1;
    expect(readAloudAvailable({ getKey: () => 'k', now: () => t })).toBe(true);
  });

  it('no key: typed error, no request', async () => {
    let n = 0;
    const fetchFn = (async () => { n++; return ok(); }) as unknown as typeof fetch;
    await expect(synthesizeReadAloud({ text: 'Привет, как дела.', voice: 'aria', language: 'ru' }, { fetchFn, getKey: () => undefined })).rejects.toBeInstanceOf(TtsError);
    await expect(synthesizeReadAloud({ text: 'Привет, как дела.', voice: 'aria', language: 'ru' }, { fetchFn, getKey: () => undefined })).rejects.toMatchObject({ kind: 'no_key' });
    expect(n).toBe(0);
    expect(readAloudAvailable({ getKey: () => undefined })).toBe(false);
    expect(getReadAloudStats().noKey).toBeGreaterThanOrEqual(2);
  });

  it('network failure, timeout and a truncated body are typed errors', async () => {
    const mk = (f: () => Promise<Response>) => synthesizeReadAloud({ text: 'Привет, как дела.', voice: 'aria', language: 'ru' }, { fetchFn: f as unknown as typeof fetch, getKey: () => 'k', sleep: noSleep });
    await expect(mk(async () => { throw new Error('ECONNRESET'); })).rejects.toMatchObject({ kind: 'upstream' });
    await expect(mk(async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; })).rejects.toMatchObject({ kind: 'timeout' });
    await expect(mk(async () => new Response(Buffer.alloc(50), { status: 200 }))).rejects.toMatchObject({ kind: 'bad_audio' });
    await expect(mk(async () => new Response('nope', { status: 401 }))).rejects.toMatchObject({ kind: 'upstream', status: 401 });
  });

  it('the error and the counters never carry the text', async () => {
    const fetchFn = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    try { await synthesizeReadAloud({ text: 'секретное содержание встречи', voice: 'aria', language: 'ru' }, { fetchFn, getKey: () => 'k', sleep: noSleep }); } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/секрет/);
    }
    expect(JSON.stringify(getReadAloudStats())).not.toMatch(/секрет/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
/** A session with the flag on: Russian meeting, live-stt primary. Speech calls record the language they were asked for. */
function makeMl(env: Record<string, string> = {}, opts: { configuredLanguage?: string | null; livePrimary?: boolean; ttsAvailable?: (l: string) => boolean; synthFails?: (l: string) => Error | null; answer?: (i: any) => any; postChat?: (t: string) => Promise<void> } = {}) {
  const w = makeWorld({ ...ML, ...env }, { hasLiveStream: true, answer: opts.answer });
  const synthCalls: Array<{ text: string; lang?: string }> = [];
  const phraseCalls: Array<{ text: string; lang?: string }> = [];
  const logs: Array<{ type: string; fields: Record<string, unknown> }> = [];
  const answered: any[] = [];
  const deps = {
    ...w.deps,
    answer: async (i: any) => { answered.push(i); return (opts.answer ? opts.answer(i) : answerOf('Вы решили запускать продукт в пятницу.')); },
    synth: async (text: string, lang?: string) => {
      synthCalls.push({ text, lang });
      const err = lang ? opts.synthFails?.(lang) : null;
      if (err) throw err;
      return { b64: `say:${lang ?? 'en'}:${text}`, seconds: 3, chars: text.length, usd: 0.0003, ms: 120 };
    },
    phrase: async (text: string, lang?: string) => { phraseCalls.push({ text, lang }); return { b64: `phrase:${lang ?? 'en'}:${text}`, seconds: 1, chars: text.length, usd: 0, ms: 0 }; },
    livePrimary: opts.livePrimary ?? true,
    configuredLanguage: opts.configuredLanguage === undefined ? 'ru' : opts.configuredLanguage,
    ttsAvailable: opts.ttsAvailable,
    postChat: opts.postChat,
    log: (type: string, fields: Record<string, unknown>) => { logs.push({ type, fields }); },
  };
  const session = new VoiceSession(deps as any);
  const live = async (text: string, language: string | null = 'ru', speaker = OWNER) => {
    await new Promise((r) => setImmediate(r));
    await session.onTranscript({ speaker, text, partial: false, source: 'live_stt', language });
  };
  return Object.assign(w, { session, live, synthCalls, phraseCalls, logs, answered, played: () => w.plays.map((p) => p.b64) });
}

describe('session with the flag on', () => {
  it('a Russian question on the live stream gets a Russian cue and a Russian answer, in Russian speech, with language passed to the model', async () => {
    const m = makeMl();
    await m.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await m.session.whenIdle();
    expect(m.answered).toHaveLength(1);
    expect(m.answered[0].language).toBe('ru');
    expect(m.answered[0].question).toBe('что мы решили насчёт даты запуска?');
    expect(m.played()).toEqual(['phrase:ru:Сейчас проверю.', 'say:ru:Вы решили запускать продукт в пятницу.']);
    const done = m.events.find((e) => e.type === 'answered')!;
    expect(done.detail).toBe('ru');
    expect(JSON.stringify(m.events)).not.toMatch(/запуска|пятниц/); // no text in metric events
  });

  it('the bot own Russian answer, heard back, does not wake or restart it', async () => {
    const m = makeMl();
    await m.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await m.session.whenIdle();
    const before = m.answered.length;
    m.advance(3000);
    await m.live('Вы решили запускать продукт в пятницу.', 'ru', { name: 'Meeting Mind', email: null } as any);
    await m.live('вы решили запускать продукт в пятницу', 'ru', { name: 'Someone', email: null } as any);
    await m.session.whenIdle();
    expect(m.answered.length).toBe(before);
    expect(m.types()).toContain('echo_suppressed');
  });

  it('even an answer that names the product cannot wake the bot through its own echo', async () => {
    const m = makeMl({}, { answer: () => answerOf('Скажите Митинг Майнд и задайте вопрос ещё раз.') });
    await m.live('Митинг майнд, как мне тебя позвать?');
    await m.session.whenIdle();
    const said = m.synthCalls[0]!.text;
    expect(detectWakeMulti(said, m.cfg())).toBeNull();
    const n = m.answered.length;
    m.advance(2500);
    await m.live(said, 'ru', { name: 'Room mic', email: null } as any);
    await m.session.whenIdle();
    expect(m.answered.length).toBe(n);
  });

  it('digits in a Russian answer never reach speech', async () => {
    const m = makeMl({}, { answer: () => answerOf('Встреча в 14:30, бюджет 15% от 2000 долларов.') });
    await m.live('Митинг майнд, когда встреча и какой бюджет?');
    await m.session.whenIdle();
    expect(m.synthCalls).toHaveLength(1);
    expect(m.synthCalls[0]!.text).not.toMatch(/\d/);
    expect(m.synthCalls[0]!.text).toContain('четырнадцать тридцать');
  });

  it('a Russian wake phrase with the question coming next works (pending), and the English wake phrase works in a Russian meeting', async () => {
    const m = makeMl();
    await m.live('Митинг майнд');
    await m.live('что мы решили насчёт даты запуска продукта?');
    await m.session.whenIdle();
    expect(m.answered).toHaveLength(1);
    const e = makeMl();
    await e.live('Meeting Mind, what did we decide about the launch date?', 'en');
    await e.session.whenIdle();
    expect(e.answered).toHaveLength(1);
    expect(e.answered[0].language).toBeUndefined();
    expect(e.played()).toEqual(['phrase:en:Let me check.', 'say:en:Вы решили запускать продукт в пятницу.']); // English line, English provider
  });

  it('ordinary Russian talk, including the word "митинг", is ignored', async () => {
    const m = makeMl();
    await m.live('Митинг в пятницу перенесли на вечер, не забудьте предупредить всех.');
    await m.live('Давайте проведём митинг завтра утром.');
    await m.session.whenIdle();
    expect(m.answered).toHaveLength(0);
    expect(m.plays).toHaveLength(0);
  });

  it('a Russian stop word while it speaks stops the audio', async () => {
    const m = makeMl();
    await m.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await m.session.whenIdle();
    m.advance(500); // still speaking (3 s of audio)
    await m.live('стоп');
    expect(m.stops.length).toBeGreaterThan(0);
  });

  it('a language that is not supported: said once per meeting, in English, no model call; the second time silent', async () => {
    const m = makeMl({ MEETING_ASSISTANT_LANGUAGES: 'ru' });
    await m.live('Meeting Mind, що ми вирішили щодо дати запуску продукту?', 'uk');
    await m.session.whenIdle();
    expect(m.answered).toHaveLength(0);
    expect(m.played()).toEqual(['phrase:en:Sorry, I can only answer in English and Russian for now.']);
    m.advance(60_000);
    await m.live('Meeting Mind, що ми вирішили щодо дати запуску продукту?', 'uk');
    await m.session.whenIdle();
    expect(m.played()).toHaveLength(1);
    expect(m.logs.filter((l) => l.type === 'language_unsupported')).toHaveLength(1);
  });

  it('English question in an otherwise Russian meeting is answered in English by the English provider', async () => {
    const m = makeMl();
    await m.live('Meeting Mind, what did we decide about the launch date?', 'en');
    await m.session.whenIdle();
    expect(m.synthCalls[0]!.lang).toBeUndefined();
  });

  it('no credits (402) or no key: silent, one typed log line, the optional chat hook is offered the text, no failure loop', async () => {
    const chat: string[] = [];
    const m = makeMl({}, { synthFails: () => new TtsError('no_credits', 402), postChat: async (t) => { chat.push(t); } });
    await m.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await m.session.whenIdle();
    m.advance(60_000);
    await m.live('Митинг майнд, что мы решили насчёт бюджета на квартал?');
    await m.session.whenIdle();
    expect(m.played().filter((p) => p.startsWith('say:'))).toHaveLength(0);
    expect(m.logs.filter((l) => l.type === 'tts_unavailable')).toHaveLength(1);
    const failed = m.events.filter((e) => e.type === 'failed');
    expect(failed.length).toBe(2);
    expect(failed.every((e) => e.failure === 'tts' && e.detail === 'no_credits')).toBe(true);
    expect(chat.length).toBe(2);
    const k = makeMl({}, { synthFails: () => new TtsError('no_key') });
    await k.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await k.session.whenIdle();
    expect(k.events.some((e) => e.type === 'failed' && e.detail === 'no_key')).toBe(true);
  });

  it('speech marked unavailable up front: no model call is paid for, one log line', async () => {
    const m = makeMl({}, { ttsAvailable: () => false });
    await m.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await m.session.whenIdle();
    m.advance(60_000);
    await m.live('Митинг майнд, что мы решили насчёт бюджета на квартал?');
    await m.session.whenIdle();
    expect(m.answered).toHaveLength(0);
    expect(m.logs.filter((l) => l.type === 'tts_unavailable')).toHaveLength(1);
  });

  it('caps still apply in Russian: the limit line is said once, in Russian', async () => {
    const m = makeMl({ VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING: '1' });
    await m.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await m.session.whenIdle();
    m.advance(30_000);
    await m.live('Митинг майнд, что мы решили насчёт бюджета на квартал?');
    await m.session.whenIdle();
    m.advance(30_000);
    await m.live('Митинг майнд, а что насчёт найма новых людей?');
    await m.session.whenIdle();
    expect(m.answered).toHaveLength(1);
    expect(m.played().filter((p) => p === 'phrase:ru:Лимит вопросов на эту встречу исчерпан.')).toHaveLength(1);
    expect(m.events.filter((e) => e.type === 'cap_hit' && e.detail === 'meeting').length).toBe(2);
  });

  it('a failed model call after the cue plays the Russian apology', async () => {
    const m = makeMl({}, { answer: () => { throw new Error('llm down'); } });
    await m.live('Митинг майнд, что мы решили насчёт даты запуска?');
    await m.session.whenIdle();
    expect(m.played()).toContain('phrase:ru:Извините, не получилось. Задайте вопрос ещё раз.');
  });
});

describe('flag off: the English assistant is unchanged', () => {
  it('Russian speech is not a wake phrase and nothing multilingual happens', async () => {
    const w = makeWorld({}, { hasLiveStream: true });
    await w.say(OWNER, 'Митинг майнд, что мы решили насчёт даты запуска?');
    await w.session.whenIdle();
    expect(w.asked).toHaveLength(0);
    expect(w.plays).toHaveLength(0);
  });

  it('the same English meeting behaves identically with the flag off and on', async () => {
    const run = async (env: Record<string, string>) => {
      const w = makeWorld(env);
      await w.say(OWNER, 'Okay so the launch is on Friday.');
      await w.say(OWNER, 'Meeting Mind, what did we decide about the launch date?');
      await w.session.whenIdle();
      w.advance(5000);
      await w.say({ name: 'Gina Guest' }, 'You decided to ship on Friday.'); // the echo
      await w.say(OWNER, 'Meeting Mind, never mind');
      await w.session.whenIdle();
      return { asked: w.asked, spoken: w.spokenTexts(), types: w.types() };
    };
    expect(await run(ML)).toEqual(await run({}));
  });

  it('English answers never carry a language field or touch the multilingual provider, flag on or off', async () => {
    for (const env of [{}, ML]) {
      const w = makeWorld(env);
      const seen: any[] = [];
      const s = new VoiceSession({ ...w.deps, answer: async (i: any) => { seen.push(i); return answerOf('You decided to ship on Friday.'); } } as any);
      await s.onTranscript({ speaker: OWNER, text: 'Meeting Mind, what did we decide about the launch date?', partial: false });
      await s.whenIdle();
      expect('language' in seen[0]).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('createBot plan with the flag', () => {
  const base = { userId: 'user-1', serviceUrl: 'https://api.example.com', internalSecret: 'internal-secret-value', realtimeRecallTranscript: true, preference: async () => undefined };
  const withEnv = async (env: Record<string, string>, fn: () => Promise<void>) => {
    const keys = Object.keys(env);
    const old = keys.map((k) => process.env[k]);
    keys.forEach((k) => { process.env[k] = env[k]!; });
    try { await fn(); } finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]!; }); }
  };
  const introSeen: Array<{ text: string; lang?: string }> = [];
  const intro = async (text: string, lang?: string) => { introSeen.push({ text, lang }); return 'SU5UUk8='; };

  it('flag off: Soniox-primary and non-English settings change nothing (no assistant for a Soniox bot, as before)', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all' }, async () => {
      expect(await planVoiceAssistant({ ...base, realtimeRecallTranscript: false, liveStreamProvider: 'soniox', meetingLanguage: 'ru', intro })).toBeNull();
      const p = (await planVoiceAssistant({ ...base, liveStreamProvider: 'recall', meetingLanguage: 'ru', intro }))!;
      expect(p.endpoint).not.toBeNull(); // exactly the old plan
    });
  });

  it('Soniox primary: an intro but no Recall endpoint; the intro is in the meeting language when it is supported', async () => {
    introSeen.length = 0;
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', MEETING_ASSISTANT_MULTILINGUAL: '1' }, async () => {
      const ru = (await planVoiceAssistant({ ...base, realtimeRecallTranscript: false, liveStreamProvider: 'soniox', meetingLanguage: 'ru', intro }))!;
      expect(ru.endpoint).toBeNull();
      expect(ru.automaticAudioOutput).toBeDefined();
      expect(introSeen[0]!.lang).toBe('ru');
      expect(introSeen[0]!.text).toContain('Митинг Майнд');
      introSeen.length = 0;
      const auto = (await planVoiceAssistant({ ...base, realtimeRecallTranscript: false, liveStreamProvider: 'soniox', meetingLanguage: 'auto', intro }))!;
      expect(auto.endpoint).toBeNull();
      expect(introSeen[0]!.lang).toBeUndefined(); // auto: the intro stays English
      // no secret / service URL needed when there is no webhook
      expect(await planVoiceAssistant({ ...base, realtimeRecallTranscript: false, internalSecret: undefined, serviceUrl: undefined, liveStreamProvider: 'soniox', meetingLanguage: 'en', intro })).not.toBeNull();
    });
  });

  it('non-English meeting without a live-stt stream: no assistant (Recall transcript is English only)', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', MEETING_ASSISTANT_MULTILINGUAL: '1' }, async () => {
      expect(await planVoiceAssistant({ ...base, liveStreamProvider: 'recall', meetingLanguage: 'ru', intro })).toBeNull();
      expect(await planVoiceAssistant({ ...base, meetingLanguage: 'de', intro })).toBeNull();
      // English or auto on a Recall bot: the old plan with its endpoint
      expect((await planVoiceAssistant({ ...base, liveStreamProvider: 'recall', meetingLanguage: 'auto', intro }))!.endpoint).not.toBeNull();
      expect((await planVoiceAssistant({ ...base, liveStreamProvider: 'recall', meetingLanguage: 'en', intro }))!.endpoint).not.toBeNull();
    });
  });

  it('shadow stream: non-English needs VOICE_ASSISTANT_WAKE_SOURCE=live_stt, then it has both the endpoint (barge-in) and a Russian intro', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', MEETING_ASSISTANT_MULTILINGUAL: '1' }, async () => {
      expect(await planVoiceAssistant({ ...base, liveStreamProvider: 'shadow', meetingLanguage: 'ru', intro })).toBeNull();
    });
    introSeen.length = 0;
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', MEETING_ASSISTANT_MULTILINGUAL: '1', VOICE_ASSISTANT_WAKE_SOURCE: 'live_stt' }, async () => {
      const p = (await planVoiceAssistant({ ...base, liveStreamProvider: 'shadow', meetingLanguage: 'ru', intro }))!;
      expect(p.endpoint).not.toBeNull();
      expect(introSeen[0]!.lang).toBe('ru');
    });
  });

  it('kill switch and opt-out still win', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', MEETING_ASSISTANT_MULTILINGUAL: '1', VOICE_ASSISTANT_KILL: '1' }, async () => {
      expect(await planVoiceAssistant({ ...base, realtimeRecallTranscript: false, liveStreamProvider: 'soniox', meetingLanguage: 'ru', intro })).toBeNull();
    });
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', MEETING_ASSISTANT_MULTILINGUAL: '1' }, async () => {
      expect(await planVoiceAssistant({ ...base, realtimeRecallTranscript: false, preference: async () => false, liveStreamProvider: 'soniox', meetingLanguage: 'ru', intro })).toBeNull();
    });
  });

  it('a supported language whose intro cannot be rendered: still a plan, just no audio', async () => {
    await withEnv({ VOICE_ASSISTANT_MODE: 'all', MEETING_ASSISTANT_MULTILINGUAL: '1' }, async () => {
      const p = (await planVoiceAssistant({ ...base, realtimeRecallTranscript: false, liveStreamProvider: 'soniox', meetingLanguage: 'ru', intro: async () => null }))!;
      expect(p.endpoint).toBeNull();
      expect(p.automaticAudioOutput).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('manager: Soniox-primary bot', () => {
  function makeManager(env: Record<string, string>, ctx: { liveStt: boolean; livePrimary: boolean }, language: string | null = 'ru') {
    const cfgEnv = { VOICE_ASSISTANT_MODE: 'all', ...env } as NodeJS.ProcessEnv;
    const getConfig = () => loadVoiceAssistantConfig(cfgEnv);
    let t = 1_800_000_000_000;
    const asked: Array<{ question: string; language?: string }> = [];
    const plays: string[] = [];
    let lookups = 0;
    const d: ManagerDeps = {
      getConfig, now: () => t, sleep: async (ms) => { t += ms; },
      lookupBot: async () => { lookups++; return { botRunId: 'r', meetingId: 'm', userId: 'u', ...ctx }; },
      lookupLanguage: async () => language,
      ttsAvailable: () => true,
      loadPreference: async () => undefined,
      loadOwner: async () => ({ email: OWNER.email, names: [OWNER.name] }),
      loadSeed: async () => [],
      dataFor: () => ({} as any),
      answerer: async (i: any) => { asked.push({ question: i.question, language: i.language }); return answerOf('Вы решили запускать продукт в пятницу.'); },
      synth: async (text, l) => ({ b64: `say:${l ?? 'en'}:${text}`, seconds: 2, chars: text.length, usd: 0, ms: 1 }),
      phrase: async (text, l) => ({ b64: `phrase:${l ?? 'en'}:${text}`, seconds: 1, chars: text.length, usd: 0, ms: 0 }),
      play: async (_id, b64) => { plays.push(b64); }, stop: async () => {},
      metrics: new VoiceMetrics({ getConfig, now: () => t, log: () => {}, alert: () => {}, pushUsage: null }),
    };
    return { m: new VoiceAssistantManager(d), asked, plays, lookups: () => lookups };
  }
  const seg = (text: string, language: string | null = 'ru') => ({ text, speakerName: OWNER.name, isHost: false, language });

  it('flag on, Soniox primary: a Russian wake phrase on the live stream is answered in Russian (wake source stays "recall")', async () => {
    const x = makeManager(ML, { liveStt: true, livePrimary: true });
    const r = await x.m.handleLive('bot-1', [seg('Митинг майнд, что мы решили насчёт даты запуска?')]);
    expect(r.handled).toBe(true);
    await x.m.session('bot-1')!.whenIdle();
    expect(x.asked).toEqual([{ question: 'что мы решили насчёт даты запуска?', language: 'ru' }]);
    expect(x.plays).toEqual(['phrase:ru:Сейчас проверю.', 'say:ru:Вы решили запускать продукт в пятницу.']);
  });

  it('flag off: nothing happens, not even a lookup (unchanged default)', async () => {
    const x = makeManager({}, { liveStt: true, livePrimary: true });
    expect(await x.m.handleLive('bot-1', [seg('Митинг майнд, что мы решили насчёт даты запуска?')])).toEqual({ handled: false, reason: 'wake_source_recall' });
    expect(x.lookups()).toBe(0);
  });

  it('flag on, shadow bot with wake source "recall": its stream is not listened to', async () => {
    const x = makeManager(ML, { liveStt: true, livePrimary: false });
    expect(await x.m.handleLive('bot-1', [seg('Митинг майнд, что мы решили насчёт даты запуска?')])).toEqual({ handled: false, reason: 'wake_source_recall' });
    expect(x.asked).toHaveLength(0);
  });

  it('flag on, shadow bot with wake source live_stt: listened to, as before', async () => {
    const x = makeManager({ ...ML, VOICE_ASSISTANT_WAKE_SOURCE: 'live_stt' }, { liveStt: true, livePrimary: false });
    expect((await x.m.handleLive('bot-1', [seg('Meeting mind, what did we decide about the launch date?', 'en')])).handled).toBe(true);
  });

  it('flag on, a bot without a live stream: no_live_stream', async () => {
    const x = makeManager(ML, { liveStt: false, livePrimary: false });
    expect(await x.m.handleLive('bot-1', [seg('Митинг майнд, что мы решили насчёт даты запуска?')])).toEqual({ handled: false, reason: 'no_live_stream' });
  });

  it('kill switch is honoured', async () => {
    const x = makeManager({ ...ML, VOICE_ASSISTANT_KILL: '1' }, { liveStt: true, livePrimary: true });
    expect((await x.m.handleLive('bot-1', [seg('Митинг майнд, что мы решили насчёт даты запуска?')])).handled).toBe(false);
  });

  it('a lookup failure for the language never blocks the session (treated as no language)', async () => {
    const x = makeManager(ML, { liveStt: true, livePrimary: true }, null);
    const r = await x.m.handleLive('bot-1', [seg('Митинг майнд, что мы решили насчёт даты запуска?')]);
    expect(r.handled).toBe(true);
    await x.m.session('bot-1')!.whenIdle();
    expect(x.asked).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
describe('model prompt', () => {
  const base = { question: 'what did we decide', speakerName: 'Alex', allowHistory: true, recent: [], liveText: () => '', ownerName: 'Alex', data: { index: async () => [] } as any };
  it('English (no language, or "en") is byte-identical to the prompt without the field', () => {
    const plain = buildSystemPrompt(base as any, 'idx', '2026-11-15');
    expect(buildSystemPrompt({ ...base, language: 'en' } as any, 'idx', '2026-11-15')).toBe(plain);
    expect(plain).not.toMatch(/Language:/);
    const guest = { ...base, allowHistory: false };
    expect(buildSystemPrompt({ ...guest, language: 'en' } as any, 'idx', '2026-11-15')).toBe(buildSystemPrompt(guest as any, 'idx', '2026-11-15'));
  });
  it('Russian adds the language rule: answer in Russian, numbers as words, names verbatim', () => {
    for (const allowHistory of [true, false]) {
      const p = buildSystemPrompt({ ...base, allowHistory, language: 'ru' } as any, 'idx', '2026-11-15');
      expect(p).toContain('Answer in Russian only');
      expect(p).toMatch(/number.*out in words/);
      expect(p).toMatch(/names of people.*exactly/i);
      expect(p).toContain('Я могу искать прошлые встречи только для владельца аккаунта.');
    }
  });
  it('the question sent to the model names the language only for non-English', async () => {
    const seen: string[] = [];
    const complete = async (req: any) => { seen.push(req.messages[0].content); return { content: [{ type: 'text', text: 'Пятница.' }], usage: {} }; };
    const answer = createAnswerer(() => cfgOf(), complete as any, () => '2026-11-15');
    await answer({ ...base, language: 'ru' } as any);
    await answer(base as any);
    expect(seen[0]).toContain('Reply in Russian, in at most two short sentences');
    expect(seen[1]).toContain('(Reply in at most two short sentences, under 35 words.)');
  });
});
