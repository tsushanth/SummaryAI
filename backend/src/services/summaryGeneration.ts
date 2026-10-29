/**
 * Summary generation orchestration: single call for normal meetings, map-reduce for very long ones, and
 * detection (one retry, then a structured warning) of replies that overflowed or were not valid JSON.
 *
 * No network here: the caller injects `complete`, so processingService and the regenerate route keep their own
 * instrumented Anthropic clients (and per-call feature labels), and tests need no SDK mocking.
 *
 * Privacy: logs carry ids, model, stop reason and lengths only. Never transcript text, prompts or answers.
 */

import { buildSummaryPrompts, parseSummaryResponseDetailed, type ParsedSummary } from './summaryService.js';

/**
 * Output cap for summary (and merge) calls. claude-sonnet-4-6 allows up to 64k output tokens, so 8192 is well inside
 * the model maximum and still a normal non-streaming request. Was 4096, which long or non-English summaries overflowed.
 */
export const SUMMARY_MAX_TOKENS = 8192;
/** Output cap for the per-chunk notes calls (a 60k-char chunk condenses to well under this). */
export const CHUNK_NOTES_MAX_TOKENS = 2048;
/** Transcripts up to this many characters take the single-call path, exactly as before. */
export const SINGLE_CALL_MAX_CHARS = 100_000;
/** Target size of one map-reduce chunk (chunks break on speaker turns, so they land at or just under this). */
export const CHUNK_TARGET_CHARS = 60_000;
/** Chunk-notes calls in flight at once. */
export const CHUNK_CONCURRENCY = 2;

const TURN_SEPARATOR = '\n\n';

const JSON_REMINDER =
  '\n\nReturn only valid JSON in exactly the format above, with no text before or after it. Keep every field concise enough that the complete JSON object fits in your reply.';

export type SummaryCallKind = 'summary' | 'chunk' | 'merge';

export interface CompleteRequest {
  kind: SummaryCallKind;
  system: string;
  user: string;
  maxTokens: number;
}

export interface CompleteResult {
  text: string;
  /** Anthropic stop_reason ('end_turn', 'max_tokens', ...). Undefined when the caller cannot see it. */
  stopReason?: string | null;
}

export type CompleteFn = (req: CompleteRequest) => Promise<CompleteResult>;

export interface GenerateSummaryInput {
  /** Speaker-formatted turns ("[m:ss] Name: text"), one array entry per speaker turn, in order. */
  turns: string[];
  speakers: string[];
  templateId?: string | null;
  languageName?: string | null;
  complete: CompleteFn;
  /** Log context only. */
  recordingId?: string | null;
  model: string;
}

/** Split the one oversized turn that exceeds `max` on whitespace. Only used when a single turn is bigger than a chunk. */
function splitOversizedTurn(turn: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = turn;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.5) cut = max;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, '');
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Pack speaker turns into chunks of about `target` characters without splitting a turn. Concatenating the chunks
 * (joined by the turn separator) reproduces the whole transcript, so the first chunk starts and the last chunk ends
 * where the transcript does. A single turn longer than `target` is the only thing that gets split (on whitespace).
 */
export function splitTurnsIntoChunks(turns: string[], target: number = CHUNK_TARGET_CHARS): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  const flush = () => {
    if (current.length) chunks.push(current.join(TURN_SEPARATOR));
    current = [];
    currentLen = 0;
  };
  for (const turn of turns) {
    const pieces = turn.length > target ? splitOversizedTurn(turn, target) : [turn];
    for (const piece of pieces) {
      const added = piece.length + (current.length ? TURN_SEPARATOR.length : 0);
      if (current.length && currentLen + added > target) flush();
      currentLen += piece.length + (current.length ? TURN_SEPARATOR.length : 0);
      current.push(piece);
    }
  }
  flush();
  return chunks;
}

export function buildChunkNotesPrompts(opts: {
  chunk: string;
  index: number;
  total: number;
  speakers: string[];
  languageName?: string | null;
}): { system: string; user: string } {
  const lang = opts.languageName ? ` Write the notes in ${opts.languageName}.` : ' Write the notes in the language of the transcript.';
  const system = `You take faithful, concise notes on one part of a longer meeting transcript, to be merged later with the notes of the other parts.${lang} Never invent anything that is not in the transcript.`;
  const speakerList = opts.speakers.length > 1 ? `Participants: ${opts.speakers.join(', ')}\n\n` : '';
  const user = `This is part ${opts.index + 1} of ${opts.total} of one meeting transcript. Write structured notes on this part only, as plain text under these headings (omit a heading that has nothing under it):

Decisions: each decision made, and who made or agreed to it.
Action items: each commitment as "task | owner | due date if stated". Use the speaker's name as the owner.
Key facts: figures, dates, names, commitments, disagreements and open questions, with who said them.
Topics: the subjects discussed, in order, with the [m:ss] timestamp where each begins.

Rules: use names and terms exactly as written in the transcript; state only what the transcript says; keep the notes under 1000 words in total.

${speakerList}Transcript part ${opts.index + 1} of ${opts.total}:
${opts.chunk}`;
  return { system, user };
}

/** Run fn over items with at most `limit` in flight; results keep the order of items. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function warn(event: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

/**
 * One summary-JSON call with failure detection: a reply that stopped on max_tokens or did not parse is retried once
 * (JSON reminder appended to the user message). If the retry also fails, the raw-text fallback is returned, as before,
 * and a structured warning is logged.
 */
async function summaryJsonCall(
  input: GenerateSummaryInput,
  kind: 'summary' | 'merge',
  prompts: { system: string; user: string }
): Promise<ParsedSummary> {
  let last: { parsed: ReturnType<typeof parseSummaryResponseDetailed>; stopReason: string | null | undefined; textChars: number } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user = attempt === 1 ? prompts.user : prompts.user + JSON_REMINDER;
    const res = await input.complete({ kind, system: prompts.system, user, maxTokens: SUMMARY_MAX_TOKENS });
    const parsed = parseSummaryResponseDetailed(res.text);
    const overflowed = res.stopReason === 'max_tokens';
    if (!parsed.fellBack && !overflowed) return parsed.summary;
    last = { parsed, stopReason: res.stopReason, textChars: res.text.length };
    if (attempt === 1) {
      warn('summary_retry', {
        recordingId: input.recordingId ?? null,
        model: input.model,
        kind,
        stopReason: res.stopReason ?? null,
        parseFailed: parsed.fellBack,
        promptChars: prompts.user.length,
        responseChars: res.text.length,
      });
    }
  }
  warn('summary_failed_after_retry', {
    recordingId: input.recordingId ?? null,
    model: input.model,
    kind,
    stopReason: last!.stopReason ?? null,
    parseFailed: last!.parsed.fellBack,
    promptChars: prompts.user.length,
    responseChars: last!.textChars,
  });
  return last!.parsed.summary;
}

/**
 * Generate the standard summary. Up to SINGLE_CALL_MAX_CHARS of transcript: one call with the unchanged prompt.
 * Longer: map-reduce (concise notes per ~60k-character chunk, then one merge call building the usual summary JSON).
 */
export async function generateSummary(input: GenerateSummaryInput): Promise<ParsedSummary> {
  const transcriptText = input.turns.join(TURN_SEPARATOR);

  if (transcriptText.length <= SINGLE_CALL_MAX_CHARS) {
    const prompts = buildSummaryPrompts({
      templateId: input.templateId,
      transcriptText,
      speakers: input.speakers,
      languageName: input.languageName,
    });
    return summaryJsonCall(input, 'summary', prompts);
  }

  const chunks = splitTurnsIntoChunks(input.turns);
  console.log(
    JSON.stringify({
      event: 'summary_map_reduce',
      recordingId: input.recordingId ?? null,
      model: input.model,
      transcriptChars: transcriptText.length,
      chunks: chunks.length,
    })
  );

  const notes = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, async (chunk, index) => {
    const prompts = buildChunkNotesPrompts({
      chunk,
      index,
      total: chunks.length,
      speakers: input.speakers,
      languageName: input.languageName,
    });
    const res = await input.complete({ kind: 'chunk', ...prompts, maxTokens: CHUNK_NOTES_MAX_TOKENS });
    if (res.stopReason === 'max_tokens') {
      warn('summary_chunk_truncated', {
        recordingId: input.recordingId ?? null,
        model: input.model,
        chunk: index + 1,
        chunks: chunks.length,
        stopReason: res.stopReason,
        promptChars: prompts.user.length,
        responseChars: res.text.length,
      });
    }
    return res.text.trim();
  });

  const combined = notes.map((n, i) => `=== Part ${i + 1} of ${notes.length} ===\n${n}`).join(TURN_SEPARATOR);
  const prompts = buildSummaryPrompts({
    templateId: input.templateId,
    transcriptText: combined,
    speakers: input.speakers,
    languageName: input.languageName,
    fromNotes: true,
  });
  return summaryJsonCall(input, 'merge', prompts);
}
