/**
 * Pure text helpers for the in-meeting voice assistant: wake phrase, stop words, echo guard, owner matching,
 * and cleaning of the text that will be spoken. No I/O, no clocks.
 */

/**
 * The wake phrase must OPEN the utterance (after at most three filler words), so "we use Meeting Mind for notes" or
 * "I told them about meeting mind" never triggers it. Speech-to-text variants of "mind" are accepted.
 */
const FILLER = '(?:(?:so|um|uh|and|but|okay|ok|hey|hi|yo|right|well)[\\s,]+){0,3}';
const WAKE_RE = new RegExp(`^\\s*${FILLER}meeting[\\s-]?(?:mind|mine|mined|minds|mind's)\\b[\\s,.:;!?-]*(.*)$`, 'is');

export const STOP_RE = /\b(stop|never\s?mind|cancel|enough|be quiet|shut up|that'?s enough)\b/i;

export interface WakeMatch {
  /** Text after the wake phrase (may be empty: the wake phrase alone). */
  question: string;
}

export function detectWake(text: string): WakeMatch | null {
  const m = WAKE_RE.exec(text ?? '');
  if (!m) return null;
  return { question: (m[1] ?? '').trim() };
}

export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** A bare "stop" / "never mind": not a question, and when the bot is active it means be quiet. */
export function isStopRequest(text: string): boolean {
  if (!STOP_RE.test(text)) return false;
  // "Meeting Mind, what did we stop doing last week" is a question that contains the word stop.
  const w = detectWake(text);
  const body = w ? w.question : text;
  return wordCount(body) < 4;
}

const tokens = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Echo guard. The bot's own speech comes back through the meeting audio and is transcribed as if a participant said it.
 * `heard` is treated as an echo of `spoken` when most of its words (at least three of them) occur in the spoken text.
 * Containment, not equality: the transcript of synthetic speech is rarely word-for-word, and may be cut mid-sentence.
 */
export function isEchoOf(heard: string, spoken: string, threshold = 0.7): boolean {
  const h = tokens(heard);
  if (h.length < 3) return false;
  const s = new Set(tokens(spoken));
  if (s.size === 0) return false;
  const hit = h.filter((t) => s.has(t)).length;
  return hit / h.length >= threshold;
}

/** The wake phrase must never be in the bot's own speech (an echo of it would re-trigger the bot). */
export function stripWakePhrase(text: string): string {
  return text.replace(/\bmeeting[\s-]?(?:mind|mine|mined|minds)\b/gi, 'I');
}

/** Spoken-answer hygiene: no markdown, no wake phrase, one line, hard character cap cut at a word boundary. */
export function cleanSpoken(text: string, maxChars: number): string {
  let t = stripWakePhrase(text)
    .replace(/[*_`#>]+/g, '')
    .replace(/\[(?:[^\]]*)\]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars);
    const lastSentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = lastSentence > maxChars * 0.5 ? cut.slice(0, lastSentence + 1) : cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim();
  }
  return t;
}

const NOT_FOUND_RE = /^\s*NOT_FOUND\s*:?\s*/i;
/** The model marks "I searched and the data does not have it" with a leading NOT_FOUND:. Returns the speakable text. */
export function parseNotFound(raw: string): { text: string; found: boolean } {
  if (NOT_FOUND_RE.test(raw)) return { text: raw.replace(NOT_FOUND_RE, '').trim(), found: false };
  return { text: raw.trim(), found: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Who is speaking: the account owner or someone else (decides whether PAST meetings may be read aloud)
// ---------------------------------------------------------------------------------------------------------------

export interface OwnerIdentity {
  email: string | null;
  /** Every display name known for the owner (profile display name, auth metadata name). */
  names: string[];
}

export interface Speaker {
  name: string | null;
  email?: string | null;
  isHost?: boolean;
}

const nameTokens = (s: string): string[] => s.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 0);

/**
 * Is this participant the account owner? An email match is strong. A name match is weak (guests can rename themselves), so:
 * a multi-word participant name must contain all of the owner's name, or the owner's whole name must contain the participant's
 * name; a single-word name only counts when the participant is the meeting host. `emailOnly` disables name matching.
 */
export function isOwnerSpeaker(speaker: Speaker, owner: OwnerIdentity, emailOnly = false): boolean {
  if (speaker.email && owner.email && speaker.email.trim().toLowerCase() === owner.email.trim().toLowerCase()) return true;
  if (emailOnly || !speaker.name) return false;
  const p = nameTokens(speaker.name);
  if (p.length === 0) return false;
  for (const n of owner.names) {
    const o = nameTokens(n);
    if (o.length === 0) continue;
    const pSet = new Set(p);
    const oSet = new Set(o);
    const ownerInSpeaker = o.every((t) => pSet.has(t));
    const speakerInOwner = p.every((t) => oSet.has(t));
    if (p.length >= 2 && o.length >= 2 && (ownerInSpeaker || speakerInOwner)) return true;
    if (p.length >= 2 && o.length === 1 && ownerInSpeaker) return true;
    if (p.length === 1 && speakerInOwner && !!speaker.isHost) return true;
  }
  return false;
}
