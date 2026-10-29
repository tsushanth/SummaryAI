import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateSummary,
  splitTurnsIntoChunks,
  SUMMARY_MAX_TOKENS,
  CHUNK_NOTES_MAX_TOKENS,
  SINGLE_CALL_MAX_CHARS,
  CHUNK_TARGET_CHARS,
  CHUNK_CONCURRENCY,
  type CompleteRequest,
  type CompleteResult,
} from '../src/services/summaryGeneration.js';
import { buildSummaryPrompts, parseSummaryResponse, parseSummaryResponseDetailed } from '../src/services/summaryService.js';
import { getSummaryTemplate } from '../src/services/summaryTemplates.js';

const GOOD = JSON.stringify({ summary: 'S', key_points: ['k'], action_items: [{ task: 't', assignee: 'Ann' }], topics: ['x'] });

/** Turns of ~`size` chars each, numbered so the last one is identifiable. */
function makeTurns(count: number, size = 400): string[] {
  return Array.from({ length: count }, (_, i) => {
    const head = `[${i}:00] ${i % 2 ? 'Bob' : 'Ann'}: TURN-${i}-START `;
    return head + 'w'.repeat(Math.max(0, size - head.length - 12)) + ` TURN-${i}-END`;
  });
}

function fakeComplete(reply: (req: CompleteRequest, n: number) => CompleteResult | string) {
  const calls: CompleteRequest[] = [];
  const fn = vi.fn(async (req: CompleteRequest) => {
    calls.push(req);
    const r = reply(req, calls.length);
    return typeof r === 'string' ? { text: r, stopReason: 'end_turn' } : r;
  });
  return { fn, calls };
}

let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('constants', () => {
  it('has the agreed caps and sizes', () => {
    expect(SUMMARY_MAX_TOKENS).toBe(8192);
    expect(SUMMARY_MAX_TOKENS).toBeLessThanOrEqual(64000); // claude-sonnet-4-6 maximum output
    expect(CHUNK_NOTES_MAX_TOKENS).toBe(2048);
    expect(SINGLE_CALL_MAX_CHARS).toBe(100_000);
    expect(CHUNK_TARGET_CHARS).toBe(60_000);
    expect(CHUNK_CONCURRENCY).toBe(2);
  });
});

describe('short transcript (<= 100,000 chars): the unchanged single-call path', () => {
  it('makes exactly one call with the same prompt as before', async () => {
    const turns = makeTurns(10);
    const { fn, calls } = fakeComplete(() => GOOD);
    const out = await generateSummary({ turns, speakers: ['Ann', 'Bob'], templateId: 'standup', complete: fn, model: 'm', recordingId: 'r1' });

    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('summary');
    expect(calls[0].maxTokens).toBe(SUMMARY_MAX_TOKENS);
    const expected = buildSummaryPrompts({ templateId: 'standup', transcriptText: turns.join('\n\n'), speakers: ['Ann', 'Bob'] });
    expect(calls[0].system).toBe(expected.system);
    expect(calls[0].user).toBe(expected.user);
    expect(out.summary).toBe('S');
    expect(out.actionItems[0].assignee).toBe('Ann');
  });

  it('keeps the legacy prompt text byte for byte (no notes preamble, label "Transcript:")', () => {
    const t = getSummaryTemplate('general');
    const p = buildSummaryPrompts({ transcriptText: 'TXT', speakers: ['A', 'B'], languageName: 'Spanish' });
    expect(p.user.startsWith(`Analyze this transcript and produce a "${t.name}" summary.\n\nTemplate instructions: ${t.instructions}\n\nAlso provide action items (if any; include who committed to each as the assignee) and the main topics discussed.\n\nParticipants: A, B\n\nTranscript:\nTXT\n\nImportant: reference speakers by name`)).toBe(true);
    expect(p.user).not.toContain('condensed');
  });

  it('a transcript of exactly 100,000 chars is still one call', async () => {
    const turns = ['x'.repeat(SINGLE_CALL_MAX_CHARS)];
    const { fn, calls } = fakeComplete(() => GOOD);
    await generateSummary({ turns, speakers: ['A'], complete: fn, model: 'm' });
    expect(calls).toHaveLength(1);
    expect(calls[0].user).toContain(turns[0]);
  });
});

describe('long transcript: map-reduce', () => {
  // 250,000+ chars of ~500-char turns
  const turns = makeTurns(520, 500);
  const total = turns.join('\n\n').length;

  it('is long enough for the test to mean something', () => expect(total).toBeGreaterThan(250_000));

  it('makes N chunk calls plus one merge call, and the end of the transcript is in the last chunk', async () => {
    const { fn, calls } = fakeComplete((req) => (req.kind === 'chunk' ? 'Decisions: none' : GOOD));
    const out = await generateSummary({ turns, speakers: ['Ann', 'Bob'], templateId: 'sales_call', complete: fn, model: 'm', recordingId: 'r1' });

    const chunkCalls = calls.filter((c) => c.kind === 'chunk');
    const mergeCalls = calls.filter((c) => c.kind === 'merge');
    expect(chunkCalls.length).toBe(splitTurnsIntoChunks(turns).length);
    expect(chunkCalls.length).toBeGreaterThanOrEqual(4);
    expect(mergeCalls).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'summary')).toHaveLength(0);
    expect(calls[calls.length - 1].kind).toBe('merge');
    expect(out.summary).toBe('S');

    // first chunk starts at the transcript start, last chunk ends at the transcript end
    expect(chunkCalls[0].user).toContain('TURN-0-START');
    expect(chunkCalls[chunkCalls.length - 1].user).toContain('TURN-519-END');
    // every turn appears in exactly one chunk prompt
    for (let i = 0; i < turns.length; i += 37) {
      expect(chunkCalls.filter((c) => c.user.includes(`TURN-${i}-START`))).toHaveLength(1);
    }
    for (const c of chunkCalls) expect(c.maxTokens).toBe(CHUNK_NOTES_MAX_TOKENS);
    expect(mergeCalls[0].maxTokens).toBe(SUMMARY_MAX_TOKENS);
  });

  it('merge call uses the template, participants and combined notes, not the raw transcript', async () => {
    const { fn, calls } = fakeComplete((req) => (req.kind === 'chunk' ? `NOTES-FOR-${req.user.match(/part (\d+) of/)![1]}` : GOOD));
    await generateSummary({ turns, speakers: ['Ann', 'Bob'], templateId: 'standup', complete: fn, model: 'm' });
    const merge = calls.find((c) => c.kind === 'merge')!;
    const n = calls.filter((c) => c.kind === 'chunk').length;
    expect(merge.user).toContain('Blockers'); // standup template instructions
    expect(merge.user).toContain('Participants: Ann, Bob');
    expect(merge.user).toContain(`=== Part 1 of ${n} ===\nNOTES-FOR-1`);
    expect(merge.user).toContain(`=== Part ${n} of ${n} ===\nNOTES-FOR-${n}`);
    expect(merge.user).toContain('Respond with ONLY valid JSON');
    expect(merge.user).not.toContain('TURN-250-START');
  });

  it('runs chunk calls with concurrency 2', async () => {
    let inFlight = 0;
    let peak = 0;
    const fn = vi.fn(async (req: CompleteRequest) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { text: req.kind === 'chunk' ? 'notes' : GOOD, stopReason: 'end_turn' };
    });
    await generateSummary({ turns, speakers: ['A', 'B'], complete: fn, model: 'm' });
    expect(peak).toBe(2);
  });

  it('keeps the language instruction in chunk notes and in the merge call', async () => {
    const { fn, calls } = fakeComplete((req) => (req.kind === 'chunk' ? 'notes' : GOOD));
    await generateSummary({ turns, speakers: ['Ann', 'Bob'], languageName: 'Spanish', complete: fn, model: 'm' });
    for (const c of calls.filter((c) => c.kind === 'chunk')) expect(c.system).toContain('Spanish');
    const merge = calls.find((c) => c.kind === 'merge')!;
    expect(merge.system).toContain('Spanish');
    expect(merge.user).toContain('in Spanish. JSON keys remain in English');
  });

  it('chunk-notes prompt asks for decisions, action items with owner/due date, exact names, nothing invented', async () => {
    const { fn, calls } = fakeComplete((req) => (req.kind === 'chunk' ? 'n' : GOOD));
    await generateSummary({ turns, speakers: ['Ann', 'Bob'], complete: fn, model: 'm' });
    const u = calls[0].user;
    expect(u).toMatch(/Decisions/);
    expect(u).toMatch(/Action items.*owner.*due date/);
    expect(u).toMatch(/exactly as written/);
    expect(u).toMatch(/state only what the transcript says/);
  });

  it('propagates an API error from a chunk call (processing fails as it does today)', async () => {
    const fn = vi.fn(async (req: CompleteRequest) => {
      if (req.kind === 'chunk') throw new Error('overloaded');
      return { text: GOOD };
    });
    await expect(generateSummary({ turns, speakers: ['A', 'B'], complete: fn, model: 'm' })).rejects.toThrow('overloaded');
  });

  it('warns (no content) when a chunk-notes reply was cut off by max_tokens', async () => {
    const { fn } = fakeComplete((req) => (req.kind === 'chunk' ? { text: 'SECRET-NOTES', stopReason: 'max_tokens' } : GOOD));
    await generateSummary({ turns, speakers: ['A', 'B'], complete: fn, model: 'm', recordingId: 'rec-9' });
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('summary_chunk_truncated') && l.includes('rec-9'))).toBe(true);
    expect(lines.join('\n')).not.toContain('SECRET-NOTES');
  });
});

describe('splitTurnsIntoChunks', () => {
  it('never splits a speaker turn, and the chunks reassemble to the whole transcript', () => {
    const turns = makeTurns(700, 450);
    const chunks = splitTurnsIntoChunks(turns);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.join('\n\n')).toBe(turns.join('\n\n'));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
      const parts = chunk.split('\n\n');
      for (const p of parts) expect(turns).toContain(p);
    }
    // chunks are close to the target (all but the last are over 90% full)
    for (const chunk of chunks.slice(0, -1)) expect(chunk.length).toBeGreaterThan(CHUNK_TARGET_CHARS * 0.9);
  });

  it('puts a turn bigger than the target alone, split on whitespace, and loses no text', () => {
    const big = Array.from({ length: 30_000 }, (_, i) => `word${i}`).join(' '); // ~ 230k chars
    const turns = ['[0:00] A: hi', big, '[9:00] B: bye'];
    const chunks = splitTurnsIntoChunks(turns);
    expect(chunks[0]).toBe('[0:00] A: hi');
    expect(big.startsWith(chunks[1])).toBe(true);
    expect(chunks[chunks.length - 1].endsWith('[9:00] B: bye')).toBe(true);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
    const words = chunks.join(' ').split(/\s+/);
    expect(words).toContain('word29999');
    expect(words.filter((w) => w.startsWith('word')).length).toBe(30_000);
  });

  it('handles empty input', () => expect(splitTurnsIntoChunks([])).toEqual([]));
});

describe('failure detection and retry', () => {
  const turns = makeTurns(10);

  it('stop_reason max_tokens triggers exactly one retry with the JSON reminder, and the retry result is used', async () => {
    const { fn, calls } = fakeComplete((_r, n) => (n === 1 ? { text: '{"summary":"cut of', stopReason: 'max_tokens' } : GOOD));
    const out = await generateSummary({ turns, speakers: ['A', 'B'], complete: fn, model: 'm', recordingId: 'r1' });
    expect(calls).toHaveLength(2);
    expect(calls[0].user).not.toContain('Return only valid JSON');
    expect(calls[1].user.startsWith(calls[0].user)).toBe(true);
    expect(calls[1].user).toContain('Return only valid JSON');
    expect(calls[1].maxTokens).toBe(SUMMARY_MAX_TOKENS);
    expect(out.summary).toBe('S');
  });

  it('a parse failure triggers exactly one retry, then falls back without throwing, with a structured warning', async () => {
    const { fn, calls } = fakeComplete(() => ({ text: 'SECRET sorry here is prose', stopReason: 'end_turn' }));
    const out = await generateSummary({ turns, speakers: ['A', 'B'], complete: fn, model: 'claude-x', recordingId: 'rec-1' });
    expect(calls).toHaveLength(2);
    // today's fallback: raw text as the summary, nothing else
    expect(out).toEqual({ summary: 'SECRET sorry here is prose', detailedSummary: null, keyPoints: [], actionItems: [], topics: [] });

    const lines = warn.mock.calls.map((c) => String(c[0]));
    const final = JSON.parse(lines.find((l) => l.includes('summary_failed_after_retry'))!);
    expect(final).toMatchObject({ event: 'summary_failed_after_retry', recordingId: 'rec-1', model: 'claude-x', stopReason: 'end_turn', parseFailed: true, responseChars: 26 });
    expect(typeof final.promptChars).toBe('number');
    // privacy: no transcript, prompt or answer text in any log line
    const all = [...lines, ...log.mock.calls.map((c) => String(c[0]))].join('\n');
    expect(all).not.toContain('SECRET');
    expect(all).not.toContain('TURN-');
  });

  it('still max_tokens after the retry: falls back, no third call', async () => {
    const { fn, calls } = fakeComplete(() => ({ text: '{"summary":"cut', stopReason: 'max_tokens' }));
    const out = await generateSummary({ turns, speakers: ['A', 'B'], complete: fn, model: 'm' });
    expect(calls).toHaveLength(2);
    expect(out.summary).toBe('{"summary":"cut');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('"stopReason":"max_tokens"'))).toBe(true);
  });

  it('valid JSON on the first try: no retry, no warning', async () => {
    const { fn, calls } = fakeComplete(() => GOOD);
    await generateSummary({ turns, speakers: ['A', 'B'], complete: fn, model: 'm' });
    expect(calls).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the merge call is retried the same way', async () => {
    const long = makeTurns(520, 500);
    let merges = 0;
    const { fn, calls } = fakeComplete((req) => {
      if (req.kind === 'chunk') return 'notes';
      merges++;
      return merges === 1 ? 'not json' : GOOD;
    });
    const out = await generateSummary({ turns: long, speakers: ['A', 'B'], complete: fn, model: 'm' });
    expect(calls.filter((c) => c.kind === 'merge')).toHaveLength(2);
    expect(out.summary).toBe('S');
  });
});

describe('parseSummaryResponseDetailed', () => {
  it('reports fellBack and stays compatible with parseSummaryResponse', () => {
    expect(parseSummaryResponseDetailed(GOOD).fellBack).toBe(false);
    expect(parseSummaryResponseDetailed('```json\n' + GOOD + '\n```').fellBack).toBe(false);
    const bad = parseSummaryResponseDetailed('not json');
    expect(bad.fellBack).toBe(true);
    expect(bad.summary).toEqual(parseSummaryResponse('not json'));
    expect(parseSummaryResponseDetailed('').summary.summary).toBe('Summary generation failed.');
    expect(parseSummaryResponseDetailed('[1,2]').fellBack).toBe(true);
    expect(parseSummaryResponse(GOOD).summary).toBe('S');
  });
});
