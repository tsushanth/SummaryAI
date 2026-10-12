/**
 * Summary templates: per-meeting-type formats. Every template keeps the same JSON output contract
 * (summary, key_points, action_items, topics) so clients render all of them without changes; the
 * template only changes what the model is asked to emphasise and how the `summary` text is laid out.
 * `summary` is plain text (no markdown): section headings are "Heading:" lines followed by text.
 */

export const SUMMARY_TEMPLATE_IDS = [
  'general',
  'sales_call',
  'standup',
  'one_on_one',
  'interview',
  'customer_discovery',
  'lecture',
] as const;

export type SummaryTemplateId = (typeof SUMMARY_TEMPLATE_IDS)[number];

export interface SummaryTemplate {
  id: SummaryTemplateId;
  name: string;
  description: string;
  /** Instructions injected into the summarisation prompt. */
  instructions: string;
}

export const DEFAULT_SUMMARY_TEMPLATE: SummaryTemplateId = 'general';

export const SUMMARY_TEMPLATES: SummaryTemplate[] = [
  {
    id: 'general',
    name: 'General',
    description: 'A balanced summary for any meeting or recording.',
    instructions:
      'Write a concise summary (2-3 paragraphs). Attribute key statements to speakers. Key points: 3-7 bullets. Capture decisions made and open questions in the key points.',
  },
  {
    id: 'sales_call',
    name: 'Sales call',
    description: 'Pain points, budget, decision makers, objections and next steps.',
    instructions:
      'Write the summary as plain-text sections, each a heading line ending in a colon followed by 1-3 sentences: "Overview:", "Pain points:", "Budget and timeline:", "Decision makers:", "Objections:", "Next steps:". If a section was not discussed write "Not discussed" instead of inventing. Key points should be the facts a rep would put in a CRM note. Action items must include the owner and any stated deadline.',
  },
  {
    id: 'standup',
    name: 'Standup',
    description: 'Per-person done / doing / blockers.',
    instructions:
      'Write the summary as plain-text sections per participant: a line with the person name and a colon, then "Done:", "Doing:" and "Blockers:" lines. End with a "Blockers overall:" line if anything is blocking the team. Key points should list the blockers and cross-team dependencies. Action items are unblock tasks with owners.',
  },
  {
    id: 'one_on_one',
    name: '1:1',
    description: 'Topics, feedback, growth, commitments from both sides.',
    instructions:
      'Write the summary as plain-text sections: "Topics discussed:", "Feedback given:", "Growth and goals:", "Commitments:" (state who committed to what). Be factual and neutral in tone; do not add judgement that was not expressed. Key points should be the takeaways each person would want to remember.',
  },
  {
    id: 'interview',
    name: 'Interview',
    description: 'Candidate background, strengths, concerns, evidence.',
    instructions:
      'Write the summary as plain-text sections: "Candidate background:", "Strengths (with evidence):", "Concerns:", "Questions the candidate asked:", "Overall impression:". Only state what was said in the conversation; do not infer protected characteristics. Key points should be evidence-based observations. Action items are follow-ups for the hiring team.',
  },
  {
    id: 'customer_discovery',
    name: 'Customer discovery',
    description: 'Problems, current workarounds, willingness to pay, quotes.',
    instructions:
      'Write the summary as plain-text sections: "Who they are:", "Problems and frustrations:", "Current workarounds:", "Willingness to pay:", "Notable quotes:" (verbatim quotes with speaker), "Hypotheses to test next:". Key points should be insights, not paraphrased small talk. Mark anything the interviewee only implied as "implied".',
  },
  {
    id: 'lecture',
    name: 'Lecture',
    description: 'Study notes: concepts, definitions, examples, review questions.',
    instructions:
      'Write the summary as plain-text study notes with sections: "Overview:", "Key concepts:" (term then definition), "Examples:", "Review questions:" (3-5 questions a student could use to self-test). Key points should be the facts most likely to be tested. Action items are only assignments or reading explicitly mentioned (often none).',
  },
];

export function isSummaryTemplateId(value: unknown): value is SummaryTemplateId {
  return typeof value === 'string' && (SUMMARY_TEMPLATE_IDS as readonly string[]).includes(value);
}

export function getSummaryTemplate(id: string | null | undefined): SummaryTemplate {
  return (
    SUMMARY_TEMPLATES.find((t) => t.id === id) ??
    SUMMARY_TEMPLATES.find((t) => t.id === DEFAULT_SUMMARY_TEMPLATE)!
  );
}

/** Template implied by the recording type when the user chose nothing. */
export function templateForRecordingType(recordingType: string | null | undefined): SummaryTemplateId {
  if (recordingType === 'lecture') return 'lecture';
  if (recordingType === 'interview') return 'interview';
  return DEFAULT_SUMMARY_TEMPLATE;
}

/**
 * Resolve which template to use: explicit request > recording's stored template >
 * user default > recording-type default > general.
 */
export function resolveSummaryTemplate(opts: {
  requested?: string | null;
  recordingTemplate?: string | null;
  userDefault?: string | null;
  recordingType?: string | null;
}): SummaryTemplateId {
  for (const c of [opts.requested, opts.recordingTemplate, opts.userDefault]) {
    if (isSummaryTemplateId(c)) return c;
  }
  return templateForRecordingType(opts.recordingType);
}
