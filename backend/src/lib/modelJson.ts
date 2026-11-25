/**
 * Reads a JSON array out of a model reply.
 *
 * Models often wrap JSON in a Markdown code fence or add a sentence around it, even when told not to. A bare
 * JSON.parse on such a reply threw on every live-insight call (nothing was stored from 2026-08-01, when that feature
 * moved to Claude). Elements are also parsed one by one when the whole array does not parse, so one malformed or cut-off
 * element does not lose the others.
 */
export interface ModelArray {
  /** false: no array could be read at all (an empty array is ok). */
  ok: boolean;
  items: unknown[];
  /** Elements that were present but unreadable. */
  failed: number;
}

const FENCE = /```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)(?:```|$)/;
/** An array of strings, objects or arrays, or an empty one. Skips prose brackets such as "[Alex]:". */
const ARRAY_START = /\[(?=\s*["{\[\]])/;

export function parseModelJsonArray(text: string): ModelArray {
  const fenced = FENCE.exec(text)?.[1];
  const candidates = fenced === undefined ? [text] : [fenced, text];
  for (const candidate of candidates) {
    try {
      const whole = JSON.parse(candidate.trim());
      if (Array.isArray(whole)) return { ok: true, items: whole, failed: 0 };
    } catch { /* fall through to the element scan */ }
    const start = ARRAY_START.exec(candidate);
    if (!start) continue;
    const scanned = scanElements(candidate, start.index + 1);
    if (scanned.items.length > 0 || scanned.failed === 0) return { ok: true, ...scanned };
    return { ok: false, ...scanned };
  }
  return { ok: false, items: [], failed: 0 };
}

/** Walks the top level of an array that starts just before `from`, parsing each element on its own. */
function scanElements(s: string, from: number): { items: unknown[]; failed: number } {
  const items: unknown[] = [];
  let failed = 0;
  let depth = 0;
  let inString = false;
  let begin = from;
  const take = (end: number) => {
    const raw = s.slice(begin, end).trim();
    if (!raw) return;
    try { items.push(JSON.parse(raw)); } catch { failed++; }
  };
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"' || c === '\n') inString = false; // a raw newline cannot be inside a JSON string: resynchronise
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (depth === 0) {
        if (c === ']') { take(i); return { items, failed }; }
        continue;
      }
      depth--;
    } else if (c === ',' && depth === 0) {
      take(i);
      begin = i + 1;
    }
  }
  take(s.length); // the reply was cut off: keep the last element only if it is complete
  return { items, failed };
}
