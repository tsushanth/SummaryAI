import { describe, it, expect } from 'vitest';
import {
  voiceToolsAllowed,
  resolveDueText,
  summaryItemKey,
  signDraft,
  verifyDraft,
  todoIdForDraft,
  actionReadback,
  locateQuote,
  parseDebrief,
  type ActionDraftFields,
} from '../src/services/voiceTools.js';

const U = '11111111-1111-4111-8111-111111111111';

describe('voiceToolsAllowed (fails closed)', () => {
  const on = { VOICE_TOOLS_ENABLED: 'true', VOICE_TOOLS_SECRET: 's3cret', VOICE_TOOLS_USER_IDS: U };
  it('is off by default and when anything is missing', () => {
    expect(voiceToolsAllowed({}, U)).toBe(false);
    expect(voiceToolsAllowed({ ...on, VOICE_TOOLS_ENABLED: 'false' }, U)).toBe(false);
    expect(voiceToolsAllowed({ ...on, VOICE_TOOLS_SECRET: '' }, U)).toBe(false);
    expect(voiceToolsAllowed({ ...on, VOICE_TOOLS_USER_IDS: '' }, U)).toBe(false);
    expect(voiceToolsAllowed({ ...on, VOICE_TOOLS_USER_IDS: undefined }, U)).toBe(false);
    expect(voiceToolsAllowed(on, undefined)).toBe(false);
  });
  it('allows listed users (any case) and "*"', () => {
    expect(voiceToolsAllowed(on, U.toUpperCase())).toBe(true);
    expect(voiceToolsAllowed(on, '22222222-2222-4222-8222-222222222222')).toBe(false);
    expect(voiceToolsAllowed({ ...on, VOICE_TOOLS_USER_IDS: '*' }, '22222222-2222-4222-8222-222222222222')).toBe(true);
  });
});

describe('resolveDueText (deterministic, never guesses)', () => {
  // 2026-11-05 is a Thursday.
  const thu = new Date('2026-11-05T15:00:00Z');
  it('resolves relative words', () => {
    expect(resolveDueText('today', thu)).toBe('2026-11-05');
    expect(resolveDueText('tomorrow', thu)).toBe('2026-11-06');
    expect(resolveDueText('Friday', thu)).toBe('2026-11-06');
    expect(resolveDueText('thursday', thu)).toBe('2026-11-12'); // the next one, never today
    expect(resolveDueText('next friday', thu)).toBe('2026-11-13');
    expect(resolveDueText('next week', thu)).toBe('2026-11-12');
    expect(resolveDueText('in 3 days', thu)).toBe('2026-11-08');
    expect(resolveDueText('2026-12-01', thu)).toBe('2026-12-01');
  });
  it('uses the time zone of the user for "today"', () => {
    const lateUtc = new Date('2026-11-06T02:00:00Z'); // still Thursday evening in Los Angeles
    expect(resolveDueText('today', lateUtc, 'America/Los_Angeles')).toBe('2026-11-05');
    expect(resolveDueText('today', lateUtc, 'UTC')).toBe('2026-11-06');
    expect(resolveDueText('today', lateUtc, 'Not/AZone')).toBe('2026-11-06'); // unknown zone falls back to UTC
  });
  it('returns null for anything it does not understand', () => {
    for (const t of ['', null, undefined, 'soon', 'end of quarter', 'the 5th', '2026-13-45', 'next month']) {
      expect(resolveDueText(t as any, thu)).toBeNull();
    }
  });
});

describe('summaryItemKey', () => {
  it('is stable, per recording, and ignores case and spacing', () => {
    const a = summaryItemKey('rec-1', 'Send the deck to Dan');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(summaryItemKey('rec-1', '  send the   DECK to dan ')).toBe(a);
    expect(summaryItemKey('rec-2', 'Send the deck to Dan')).not.toBe(a);
  });
});

describe('signed action drafts', () => {
  const fields: ActionDraftFields = { title: 'Send the deck', assignee: 'Dan', due_date: '2026-11-06', priority: 'high', recording_id: null, summary_item_key: null };
  const secret = 'test-secret';
  it('round trips for the same user', () => {
    const tok = signDraft(secret, U, fields, 1000);
    const r = verifyDraft(secret, U, tok, 2000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields).toEqual(fields);
  });
  it('rejects another user, a wrong secret, a changed payload, an expired draft and junk', () => {
    const tok = signDraft(secret, U, fields, 1000);
    expect(verifyDraft(secret, 'someone-else', tok, 2000)).toEqual({ ok: false, reason: 'wrong_user' });
    expect(verifyDraft('other', U, tok, 2000)).toEqual({ ok: false, reason: 'bad_signature' });
    const [v, payload, mac] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ u: U, f: { ...fields, title: 'Wire the money' }, exp: 9e12 })).toString('base64url');
    expect(verifyDraft(secret, U, `${v}.${forged}.${mac}`, 2000)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(payload.length).toBeGreaterThan(10);
    expect(verifyDraft(secret, U, tok, 1000 + 11 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyDraft(secret, U, 'nope', 2000)).toEqual({ ok: false, reason: 'malformed' });
  });
  it('derives one todo id per draft', () => {
    const tok = signDraft(secret, U, fields, 1000);
    expect(todoIdForDraft(tok)).toBe(todoIdForDraft(tok));
    expect(todoIdForDraft(tok)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(todoIdForDraft(tok + 'x')).not.toBe(todoIdForDraft(tok));
  });
  it('reads back the exact fields', () => {
    expect(actionReadback(fields)).toBe('Task: Send the deck. Owner: Dan. Due 2026-11-06. Save it?');
    expect(actionReadback({ ...fields, assignee: null, due_date: null })).toBe('Task: Send the deck. Save it?');
  });
});

describe('debrief: cite or decline', () => {
  const segments = [
    { start_time: 12, speaker_label: 'Ana', text: 'OK so we agreed to ship the new onboarding on Friday.' },
    { start_time: 95.4, speaker_label: 'Dan', text: "I'll send the pricing deck to Priya by Monday, no problem." },
  ];
  const full = segments.map((s) => s.text).join(' ');

  it('finds a quote ignoring case and punctuation, and reports where', () => {
    expect(locateQuote('we agreed to ship the new onboarding on friday', segments, full)).toEqual({ found: true, at: 12 });
    expect(locateQuote("i'll send the pricing deck to priya by monday", segments, full)).toEqual({ found: true, at: 95 });
    expect(locateQuote('we agreed to cut the price in half', segments, full).found).toBe(false);
    expect(locateQuote('ship', segments, full).found).toBe(false); // too short to count as a citation
  });

  it('keeps only items whose quote is in the transcript and counts the rest', () => {
    const parsed = {
      decisions: [
        { text: 'Ship onboarding Friday', quote: 'we agreed to ship the new onboarding on Friday' },
        { text: 'Cut price by half', quote: 'we decided to cut the price in half next quarter' }, // invented
        { text: 'No quote at all' },
      ],
      actions: [
        { text: 'Send pricing deck to Priya', quote: "I'll send the pricing deck to Priya by Monday", owner: 'Dan', due: 'monday' },
        { text: 'Hire a contractor', quote: 'we should hire a contractor soon', owner: 'null' }, // invented
      ],
    };
    const meetingDay = new Date('2026-11-03T10:00:00Z'); // a Tuesday
    const d = parseDebrief(parsed, segments, full, (said) => resolveDueText(said, meetingDay));
    expect(d.decisions.map((x) => x.text)).toEqual(['Ship onboarding Friday']);
    expect(d.actions).toHaveLength(1);
    expect(d.actions[0]).toMatchObject({ text: 'Send pricing deck to Priya', owner: 'Dan', due_date: '2026-11-09', at_seconds: 95 });
    expect(d.dropped).toBe(3);
  });

  it('handles junk model output without throwing', () => {
    for (const bad of [null, undefined, 'x', { decisions: 'no', actions: 5 }, {}]) {
      expect(parseDebrief(bad, segments, full, () => null)).toEqual({ decisions: [], actions: [], dropped: 0 });
    }
  });
});
