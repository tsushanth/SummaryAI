/**
 * Speaker numbering, in one place.
 *
 * Stored data counts from 0 and is never rewritten: segments carry `speaker_index` 0, 1, ... with the generated label
 * "Speaker <index>", `transcripts.speaker_names` is keyed by that index, and a "Speaker N" mention in a stored summary
 * means index N (released apps apply the names to it that way).
 *
 * People read numbers from 1. Whatever shows stored text goes through the display functions below (web:
 * lib/exportFormats.ts, Android: SpeakerNames.kt). Talk-time analytics send stored labels; both apps convert them. The summary model is also shown numbers from 1, so that a label it
 * translates counts like the rest of the app, and its reply is put back into the stored convention before saving.
 */

export type SpeakerNames = Record<string, string> | null | undefined;

export interface SpeakerSegment {
  speaker_label?: string;
  speaker_index?: number;
}

/** "Speakers 0 and 1" (a list), or one "Speaker 0", optionally as the "Part 2 speaker 0" of a recording transcribed in parts. */
const MENTION =
  /\bSpeakers\s+\d+(?:(?:\s*,\s*(?:and\s+|&\s*)?|\s+and\s+|\s*&\s*)\d+\b)+|\b(?:Part\s+\d+\s+)?Speaker\s+\d+\b/gi;
const GENERATED_LABEL = /^Speaker (\d+)$/;
const PART_LABEL = /^Part (\d+) speaker (\d+)$/;
const LAST_NUMBER = /\d+$/;

function nameFor(names: SpeakerNames, index: number | string): string | undefined {
  return names?.[String(index)]?.trim() || undefined;
}

/** Stored free text (summary, key point, action item, assignee) as a person should read it. */
export function displaySpeakerText(text: string, names?: SpeakerNames): string {
  let out = text.replace(MENTION, (mention) => {
    if (/^Part/i.test(mention)) return mention.replace(LAST_NUMBER, (n) => String(Number(n) + 1));
    if (/^Speakers/i.test(mention)) {
      const numbers = mention.match(/\d+/g) ?? [];
      if (!numbers.some((n) => nameFor(names, n))) return mention.replace(/\d+/g, (n) => String(Number(n) + 1));
      return mention.replace(/^Speakers\s+/i, '').replace(/\d+/g, (n) => nameFor(names, n) ?? `Speaker ${Number(n) + 1}`);
    }
    const index = mention.match(LAST_NUMBER)![0];
    return nameFor(names, index) ?? mention.replace(LAST_NUMBER, String(Number(index) + 1));
  });
  // The model often writes the name it heard next to the label ("Speaker 1 (Alex)"), which would now read "Alex (Alex)".
  for (const raw of Object.values(names ?? {})) {
    const n = raw?.trim();
    if (n) out = out.split(`${n} (${n})`).join(n);
  }
  return out;
}

/**
 * What to call the speaker of a segment: the owner's name for them, else a generated label counted from 1, else the
 * stored label as it is (a meeting participant's name, "Document").
 */
export function speakerDisplayName(
  label: string | null | undefined,
  index: number | null | undefined,
  names?: SpeakerNames
): string {
  const named = index === null || index === undefined ? undefined : nameFor(names, index);
  if (named) return named;
  if (!label) return `Speaker ${(index ?? 0) + 1}`;
  const generated = GENERATED_LABEL.exec(label);
  if (generated) {
    const n = Number(generated[1]);
    // A number that is not the index (a bot participant id) is not ours to change.
    return index === null || index === undefined || n === index ? `Speaker ${n + 1}` : label;
  }
  const part = PART_LABEL.exec(label);
  return part ? `Part ${part[1]} speaker ${Number(part[2]) + 1}` : label;
}

/** Segments as a model should see them when its reply goes straight to a person: named, else counted from 1. */
export function withDisplaySpeakers<T extends SpeakerSegment>(segments: T[], names?: SpeakerNames): T[] {
  return segments.map((s) => ({ ...s, speaker_label: speakerDisplayName(s.speaker_label, s.speaker_index, names) }));
}

/** A stored action item (a string, or an object in any of its historical shapes) as a person should read it. */
export function displayActionItem<T>(item: T, names?: SpeakerNames): T {
  if (typeof item === 'string') return displaySpeakerText(item, names) as T;
  if (!item || typeof item !== 'object') return item;
  const out: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const key of ['task', 'title', 'text', 'description', 'assignee']) {
    const value = out[key];
    if (typeof value === 'string') out[key] = displaySpeakerText(value, names);
  }
  return out as T;
}

/**
 * Every wording a to-do copied from a summary action item may have: as stored (to-dos made before numbers counted from
 * 1), as read with no names (before a rename), and as read now.
 */
export function actionTitleForms(task: string, names?: SpeakerNames): string[] {
  return [task, displaySpeakerText(task), displaySpeakerText(task, names)];
}

/** The text columns of a `summaries` row as a person should read them. Columns that were not selected stay absent. */
export function displaySummary<T extends Record<string, any>>(row: T, names?: SpeakerNames): T {
  const text = (v: unknown) => (typeof v === 'string' ? displaySpeakerText(v, names) : v);
  const out: Record<string, any> = { ...row };
  for (const key of ['summary', 'detailed_summary']) if (key in out) out[key] = text(out[key]);
  for (const key of ['key_points', 'topics']) if (Array.isArray(out[key])) out[key] = out[key].map(text);
  if (Array.isArray(out.action_items)) out.action_items = out.action_items.map((i: unknown) => displayActionItem(i, names));
  return out as T;
}

/**
 * Segments for the summary prompt, with generated labels counted from 1, and `restore`, which turns the mentions of
 * exactly those speakers in the reply back into the stored 0-based convention. Labels that are not generated (names)
 * are left alone both ways.
 */
export function speakersForSummary<T extends SpeakerSegment>(
  segments: T[]
): { segments: T[]; restore: (text: string) => string } {
  const shown = new Set<number>();
  const shownParts = new Set<string>();
  const relabelled = segments.map((s) => {
    const label = s.speaker_label ?? '';
    const generated = GENERATED_LABEL.exec(label);
    if (generated && (s.speaker_index === undefined || Number(generated[1]) === s.speaker_index)) {
      const n = Number(generated[1]) + 1;
      shown.add(n);
      return { ...s, speaker_label: `Speaker ${n}` };
    }
    const part = PART_LABEL.exec(label);
    if (part) {
      const rank = Number(part[2]) + 1;
      shownParts.add(`${part[1]}:${rank}`);
      return { ...s, speaker_label: `Part ${part[1]} speaker ${rank}` };
    }
    return s;
  });

  const restore = (text: string): string =>
    text.replace(MENTION, (mention) => {
      const part = /^Part\s+(\d+)/i.exec(mention);
      if (part) {
        const rank = Number(mention.match(LAST_NUMBER)![0]);
        return shownParts.has(`${part[1]}:${rank}`) ? mention.replace(LAST_NUMBER, String(rank - 1)) : mention;
      }
      return mention.replace(/\d+/g, (n) => (shown.has(Number(n)) ? String(Number(n) - 1) : n));
    });

  return { segments: relabelled, restore };
}
