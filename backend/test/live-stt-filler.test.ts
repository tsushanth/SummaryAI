import { describe, it, expect } from 'vitest';
import { fillerConfigFrom, filterFillerSegments, isFillerText } from '../src/lib/liveSttFiller.js';

const cfg = fillerConfigFrom({});

describe('filler filter: junk strings from the 2026-11-07 shadow run are dropped', () => {
  it.each(['Hmm.', 'hmm', 'Hmm...', 'Mm', 'Mm.', 'mmm', 'Mhm.', 'Mm-hmm.', 'mm hmm', 'Hmmmm', 'Uh', 'Uh.', 'Um', 'Um.', 'Umm,', 'Uhm', 'Er', 'Erm.', '...', '…', '.', '-', '?', '--', ' ', '', 'Uh, um.', 'Hmm. Mm.'])(
    'drops %j', (t) => { expect(isFillerText(t, 'en', cfg)).toBe(true); }
  );
  it('treats an unknown or missing language like English plus the universal sounds', () => {
    expect(isFillerText('Um.', null, cfg)).toBe(true);
    expect(isFillerText('Um.', undefined, cfg)).toBe(true);
    expect(isFillerText('Hmm.', 'xx', cfg)).toBe(true);
  });
});

describe('filler filter: legitimate short utterances are kept', () => {
  it.each(['Yes.', 'No.', 'OK.', 'Okay.', 'Yeah.', 'Yep', 'Nope.', 'Sure.', 'Right.', 'Thanks.', 'Hello?', 'Oh.', 'Ah.', 'Huh?', 'Wow.', 'Uh-huh.', 'Uh-uh.', 'Mm-mm.', 'Eh?',
    '1', '42.', '3.5', '2026', 'One.', 'I.', 'A.', 'Q3', '5pm', '100%', 'Hmm, yes.', 'Um, no.', 'Hmm okay', 'Mhm, sounds good.', 'No, thanks.'])(
    'keeps %j', (t) => { expect(isFillerText(t, 'en', cfg)).toBe(false); }
  );
  it('never rewrites a segment that mixes a filler with real words', () => {
    const r = filterFillerSegments([{ segment_text: 'Um, yes.', language: 'en' }], cfg);
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.segment_text).toBe('Um, yes.');
  });
});

describe('filler filter: language aware', () => {
  it.each([
    ['äh', 'de'], ['Ähm.', 'de'], ['Euh...', 'fr'], ['Hum.', 'fr'], ['Eh.', 'es'], ['Ehm', 'it'], ['Hum.', 'pt'], ['Öh', 'sv'], ['Øh', 'da'],
    ['Yyy.', 'pl'], ['Ээ.', 'ru'], ['えーと', 'ja'], ['えっと、', 'ja'], ['あのー', 'ja'], ['呃', 'zh'], ['음...', 'ko'], ['เอ่อ', 'th'], ['אה', 'he'],
  ])('drops %j in %s', (t, lang) => { expect(isFillerText(t, lang, cfg)).toBe(true); });

  it.each([
    ['Er.', 'de'],        // German "er" = he
    ['Um.', 'de'],        // German "um" = at/around
    ['Eh.', 'en'],        // not in the English list (Canadian tag, not a hesitation)
    ['はい', 'ja'], ['うん', 'ja'], ['ええ', 'ja'], // yes
    ['嗯', 'zh'],         // mostly "yes/uh-huh"
    ['응', 'ko'], ['어.', 'ko'], // yes / informal yeah
    ['Sí.', 'es'], ['Oui.', 'fr'], ['Ja.', 'de'], ['Nein.', 'de'], ['Да.', 'ru'], ['Нет.', 'ru'], ['No.', 'pl'], ['Ну.', 'ru'],
    ['Este.', 'es'],
  ])('keeps %j in %s', (t, lang) => { expect(isFillerText(t, lang, cfg)).toBe(false); });

  it('a filler of another language is not dropped when the segment language is known', () => {
    expect(isFillerText('Euh.', 'de', cfg)).toBe(false);
    expect(isFillerText('Äh.', 'en', cfg)).toBe(false);
  });
  it('accepts region subtags and case', () => {
    expect(isFillerText('Euh', 'FR-ca', cfg)).toBe(true);
    expect(isFillerText('Er', 'de-AT', cfg)).toBe(false);
  });
});

describe('filler filter: configuration', () => {
  it('LIVE_STT_FILLER_FILTER=off keeps everything', () => {
    const off = fillerConfigFrom({ LIVE_STT_FILLER_FILTER: 'off' });
    expect(isFillerText('Hmm.', 'en', off)).toBe(false);
    expect(isFillerText('...', 'en', off)).toBe(false);
  });
  it('LIVE_STT_FILLER_EXTRA adds tokens for every language', () => {
    const c = fillerConfigFrom({ LIVE_STT_FILLER_EXTRA: 'Like, you know ,basically' });
    expect(isFillerText('Like.', 'en', c)).toBe(true);
    expect(isFillerText('Basically.', 'fr', c)).toBe(true);
    expect(isFillerText('Like it.', 'en', c)).toBe(false);
  });
  it('LIVE_STT_FILLER_ALLOW wins over every list', () => {
    const c = fillerConfigFrom({ LIVE_STT_FILLER_ALLOW: 'mm,um' });
    expect(isFillerText('Mm.', 'en', c)).toBe(false);
    expect(isFillerText('Um.', 'en', c)).toBe(false);
    expect(isFillerText('Uh.', 'en', c)).toBe(true);
  });
  it('defaults: enabled with empty extra/allow lists', () => {
    expect(fillerConfigFrom({})).toEqual({ enabled: true, extra: new Set(), allow: new Set() });
  });
});

describe('filterFillerSegments', () => {
  it('splits kept/dropped, counts drops per language, and uses the fallback language when a segment has none', () => {
    const segs = [
      { segment_text: 'Hmm.', language: 'en' },
      { segment_text: 'Hmm.', language: 'en' },
      { segment_text: 'Yes.', language: 'en' },
      { segment_text: 'Euh.', language: 'fr' },
      { segment_text: 'Äh.', language: null },
      { segment_text: '...' },
    ];
    const r = filterFillerSegments(segs, cfg, 'de');
    expect(r.kept.map((s) => s.segment_text)).toEqual(['Yes.']);
    expect(r.dropped).toHaveLength(5);
    expect(r.droppedByLang).toEqual({ en: 2, fr: 1, de: 2 });
  });
});
