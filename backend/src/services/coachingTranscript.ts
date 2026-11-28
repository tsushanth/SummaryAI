/**
 * Live transcript as the coach model reads it. Speech recognition delivers one sentence as many short lines, so
 * consecutive lines of one speaker are joined before the model judges them.
 */

export interface LiveLine {
  speaker_name: string | null;
  segment_text: string;
}

/** Words a spoken sentence rarely ends on. */
const OPEN_ENDING = /(?:^|\s)(a|about|an|and|are|as|at|be|because|but|by|for|from|if|is|my|of|or|our|so|than|the|their|to|was|with|your)[\s.,…-]*$/i;

/** The line stops where more is coming ("we can spend about"). English only; other lines count as finished. */
export function endsMidSentence(text: string): boolean {
  return OPEN_ENDING.test(text);
}

/** About five minutes of speech. */
export const TRANSCRIPT_MAX_CHARS = 6000;

/** `lines` oldest first. Beyond `maxChars` of speech the oldest lines are dropped, whole. */
export function joinTranscript(lines: LiveLine[], maxChars: number = TRANSCRIPT_MAX_CHARS): string {
  let from = lines.length;
  for (let used = 0; from > 0; from--) {
    used += lines[from - 1]!.segment_text.length + 1;
    if (used > maxChars && from < lines.length) break;
  }
  const turns: Array<{ speaker: string; words: string[] }> = [];
  for (const line of lines.slice(from)) {
    const speaker = line.speaker_name || 'Speaker';
    const text = line.segment_text.trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last?.speaker === speaker) last.words.push(text);
    else turns.push({ speaker, words: [text] });
  }
  return turns.map((t) => `[${t.speaker}]: ${t.words.join(' ')}`).join('\n');
}
