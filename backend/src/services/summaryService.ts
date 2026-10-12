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

/** Parse the model's reply (raw JSON, or JSON inside a code fence). Falls back to plain text. */
export function parseSummaryResponse(responseText: string): ParsedSummary {
  try {
    const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*\}/);
    const jsonString = match?.[1] || match?.[0] || responseText;
    const parsed = JSON.parse(jsonString);
    return {
      summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'No summary available.',
      keyPoints: stringArray(parsed.key_points),
      actionItems: normalizeActionItems(parsed.action_items),
      topics: stringArray(parsed.topics),
    };
  } catch {
    return {
      summary: responseText.trim() || 'Summary generation failed.',
      keyPoints: [],
      actionItems: [],
      topics: [],
    };
  }
}

export interface SummaryPromptInput {
  templateId?: string | null;
  transcriptText: string;
  speakers: string[];
  languageName?: string | null;
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
    ? `\n\nWrite the entire summary, key_points, action_items, and topics in ${input.languageName}. JSON keys remain in English; only the values are translated.`
    : '';

  const user = `Analyze this transcript and produce a "${template.name}" summary.

Template instructions: ${template.instructions}

Also provide action items (if any; include who committed to each as the assignee) and the main topics discussed.

${speakerList}Transcript:
${input.transcriptText}

Important: reference speakers by name to show who said what. For action items, use the speaker's name as the assignee when they committed to do something.${languageInstruction}

Respond with ONLY valid JSON in this format:
{
  "summary": "Plain-text summary laid out as the template instructions describe (no markdown)",
  "key_points": ["point 1", "point 2"],
  "action_items": [{"task": "description", "assignee": "Speaker name or null", "priority": "high/medium/low", "due_date": "stated deadline or null"}],
  "topics": ["topic1", "topic2"]
}`;

  const system = input.languageName
    ? `You are a helpful assistant that summarizes meeting transcripts. Write all natural-language values in ${input.languageName}; keep JSON keys in English. Always respond with ONLY valid JSON, no additional text.`
    : 'You are a helpful assistant that summarizes meeting transcripts. Always respond with ONLY valid JSON, no additional text.';

  return { system, user, template };
}
