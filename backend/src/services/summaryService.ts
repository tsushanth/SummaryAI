/**
 * Summary service: prompt construction and response normalisation for summaries.
 * Pure functions (no I/O) so they are unit-testable; the Anthropic call stays in processingService.
 */

import { getSummaryTemplate, type SummaryTemplate } from './summaryTemplates.js';

export type ActionPriority = 'high' | 'medium' | 'low';

export interface ActionItem {
  /** Canonical text of the action. Clients historically read either `task` or `title`; both are emitted. */
  task: string;
  title: string;
  assignee: string | null;
  priority: ActionPriority;
  due_date: string | null;
}

export interface ParsedSummary {
  summary: string;
  /** Fuller multi-paragraph write-up; null when the model did not return one. */
  detailedSummary: string | null;
  keyPoints: string[];
  actionItems: ActionItem[];
  topics: string[];
}

const PRIORITIES: readonly string[] = ['high', 'medium', 'low'];

/** Normalise whatever the model returned for action items into a stable shape. */
export function normalizeActionItems(raw: unknown): ActionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ActionItem[] = [];
  for (const item of raw) {
    let text: string | null = null;
    let assignee: string | null = null;
    let priority: ActionPriority = 'medium';
    let dueDate: string | null = null;

    if (typeof item === 'string') {
      text = item;
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const t = o.task ?? o.title ?? o.description;
      if (typeof t === 'string') text = t;
      if (typeof o.assignee === 'string' && o.assignee.trim() && o.assignee.trim().toLowerCase() !== 'null') {
        assignee = o.assignee.trim();
      }
      if (typeof o.priority === 'string' && PRIORITIES.includes(o.priority.toLowerCase())) {
        priority = o.priority.toLowerCase() as ActionPriority;
      }
      const d = o.due_date ?? o.deadline;
      if (typeof d === 'string' && d.trim()) dueDate = d.trim();
    }

    text = text?.trim() ?? null;
    if (!text) continue;
    out.push({ task: text, title: text, assignee, priority, due_date: dueDate });
  }
  return out;
}

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim());
}

export interface ParsedSummaryResult {
  summary: ParsedSummary;
  /** True when the reply was not usable JSON and the raw text was returned as the summary instead. */
  fellBack: boolean;
}

/**
 * Parse the model's reply (raw JSON, or JSON inside a code fence). Falls back to plain text, and reports
 * whether it did so, so callers can retry or log instead of treating a broken reply as a normal summary.
 */
export function parseSummaryResponseDetailed(responseText: string): ParsedSummaryResult {
  try {
    const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*\}/);
    const jsonString = match?.[1] || match?.[0] || responseText;
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('summary reply is not a JSON object');
    return {
      fellBack: false,
      summary: {
        summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'No summary available.',
        detailedSummary:
          typeof parsed.detailed_summary === 'string' && parsed.detailed_summary.trim() ? parsed.detailed_summary.trim() : null,
        keyPoints: stringArray(parsed.key_points),
        actionItems: normalizeActionItems(parsed.action_items),
        topics: stringArray(parsed.topics),
      },
    };
  } catch {
    return {
      fellBack: true,
      summary: {
        summary: responseText.trim() || 'Summary generation failed.',
        detailedSummary: null,
        keyPoints: [],
        actionItems: [],
        topics: [],
      },
    };
  }
}

/** Parse the model's reply (raw JSON, or JSON inside a code fence). Falls back to plain text. */
export function parseSummaryResponse(responseText: string): ParsedSummary {
  return parseSummaryResponseDetailed(responseText).summary;
}

export interface SummaryPromptInput {
  templateId?: string | null;
  transcriptText: string;
  speakers: string[];
  languageName?: string | null;
  /**
   * Map-reduce only: set when `transcriptText` is condensed notes of consecutive transcript parts instead of the
   * transcript itself. Omitted for normal meetings, which keep the exact prompt below unchanged.
   */
  fromNotes?: boolean;
}

export interface SummaryPrompts {
  system: string;
  user: string;
  template: SummaryTemplate;
}

export function buildSummaryPrompts(input: SummaryPromptInput): SummaryPrompts {
  const template = getSummaryTemplate(input.templateId);
  const speakerList = input.speakers.length > 1 ? `Participants: ${input.speakers.join(', ')}\n\n` : '';
  const languageInstruction = input.languageName
    ? `\n\nWrite the entire summary, detailed_summary, key_points, action_items, and topics in ${input.languageName}. JSON keys remain in English; only the values are translated.`
    : '';

  const notesPreamble = input.fromNotes
    ? 'The meeting was too long to read in one pass, so the transcript was condensed, in order and in full, into the notes below (one block per consecutive part, each ending where the next begins). Treat the notes as the transcript: cover the whole meeting from the first block to the last, and do not mention that it was condensed.\n\n'
    : '';
  const transcriptLabel = input.fromNotes ? 'Notes' : 'Transcript';

  const user = `Analyze this transcript and produce a "${template.name}" summary.

Template instructions: ${template.instructions}

Also provide action items (if any; include who committed to each as the assignee) and the main topics discussed.

${speakerList}${notesPreamble}${transcriptLabel}:
${input.transcriptText}

Important: reference speakers by name to show who said what. For action items, use the speaker's name as the assignee when they committed to do something.${languageInstruction}

Respond with ONLY valid JSON in this format:
{
  "summary": "Plain-text summary laid out as the template instructions describe (no markdown). Keep it short enough to read in under a minute.",
  "detailed_summary": "A fuller plain-text write-up in 3 to 6 short paragraphs separated by blank lines: the context, what was discussed topic by topic (who said what), decisions made, and open questions. No markdown, no bullet characters. Do not repeat the summary word for word.",
  "key_points": ["point 1", "point 2"],
  "action_items": [{"task": "description", "assignee": "Speaker name or null", "priority": "high/medium/low", "due_date": "stated deadline or null"}],
  "topics": ["topic1", "topic2"]
}`;

  const system = input.languageName
    ? `You are a helpful assistant that summarizes meeting transcripts. Write all natural-language values in ${input.languageName}; keep JSON keys in English. Always respond with ONLY valid JSON, no additional text.`
    : 'You are a helpful assistant that summarizes meeting transcripts. Always respond with ONLY valid JSON, no additional text.';

  return { system, user, template };
}
