/**
 * Renders the "email this summary" message. Table-based HTML with inline styles
 * (email clients ignore most CSS) plus a plain-text alternative.
 *
 * Everything interpolated into the HTML (LLM-written summary, titles, the sender's
 * note) is escaped. Transcripts are never included.
 */

export interface SummaryEmailInput {
  title: string;
  /** ISO timestamp of the recording */
  recordedAt: string;
  durationSeconds?: number | null;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  /** Optional personal note from the sender, shown above the summary */
  note?: string;
  senderEmail: string;
  webAppUrl: string;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Action items are stored as strings or {task|text|title, assignee, due_date} objects. */
export function actionItemLine(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null;
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const text = [o.task, o.text, o.title].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  if (!text) return null;
  const extras = [
    typeof o.assignee === 'string' && o.assignee.trim() ? o.assignee.trim() : null,
    typeof o.due_date === 'string' && o.due_date.trim() ? `due ${o.due_date.trim()}` : null,
  ].filter(Boolean);
  return extras.length ? `${text.trim()} (${extras.join(', ')})` : text.trim();
}

/** Subject lines must be single-line; strip control characters and cap the length. */
export function summarySubject(title: string): string {
  const clean = title.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Meeting';
  return `Meeting summary: ${clean}`.slice(0, 150);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function formatDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return '';
  const m = Math.round(sec / 60);
  if (m < 60) return `${Math.max(m, 1)} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function paragraphs(text: string): string[] {
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

export function renderSummaryEmail(input: SummaryEmailInput): { html: string; text: string } {
  const base = input.webAppUrl.replace(/\/+$/, '');
  const meta = [formatDate(input.recordedAt), formatDuration(input.durationSeconds)].filter(Boolean).join(' · ');
  const note = input.note?.trim();
  const keyPoints = input.keyPoints.filter((k) => typeof k === 'string' && k.trim());
  const actions = input.actionItems.filter(Boolean);
  const sentBy = `Shared by ${input.senderEmail} from a meeting recorded with MeetingMind.`;

  const section = (heading: string, inner: string) =>
    `<tr><td style="padding:20px 0 0 0;"><div style="font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;">${heading}</div>${inner}</td></tr>`;
  const list = (items: string[]) =>
    `<ul style="margin:0;padding-left:20px;color:#111827;font-size:15px;line-height:1.55;">${items
      .map((i) => `<li style="margin-bottom:6px;">${esc(i)}</li>`)
      .join('')}</ul>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:28px 28px 8px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="font-size:22px;font-weight:700;line-height:1.3;color:#111827;">${esc(input.title)}</td></tr>
${meta ? `<tr><td style="padding-top:4px;font-size:13px;color:#6b7280;">${esc(meta)}</td></tr>` : ''}
${note ? `<tr><td style="padding-top:16px;"><div style="border-left:3px solid #6366f1;background:#f5f5ff;padding:10px 14px;font-size:14px;line-height:1.55;color:#374151;white-space:pre-wrap;">${esc(note)}</div></td></tr>` : ''}
${section('Summary', paragraphs(input.summary).map((p) => `<p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#111827;">${esc(p)}</p>`).join('') || '<p style="margin:0;font-size:15px;color:#6b7280;">No summary available.</p>')}
${keyPoints.length ? section('Key points', list(keyPoints)) : ''}
${actions.length ? section('Action items', list(actions)) : ''}
</table></td></tr>
<tr><td style="padding:24px 28px 28px 28px;">
<div style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;line-height:1.6;color:#6b7280;">
${esc(sentBy)} You can reply to this email to reach them.<br>
Summary generated by <a href="${esc(base)}" style="color:#4f46e5;text-decoration:underline;">MeetingMind</a> &middot; <a href="${esc(base)}" style="color:#4f46e5;text-decoration:underline;">${esc(base.replace(/^https?:\/\//, ''))}</a>
</div></td></tr>
</table></td></tr></table>
</body></html>`;

  const lines = [
    input.title,
    meta,
    '',
    ...(note ? [note, ''] : []),
    'SUMMARY',
    ...paragraphs(input.summary).flatMap((p) => [p, '']),
    ...(keyPoints.length ? ['KEY POINTS', ...keyPoints.map((k) => `- ${k}`), ''] : []),
    ...(actions.length ? ['ACTION ITEMS', ...actions.map((a) => `- ${a}`), ''] : []),
    '--',
    `${sentBy} You can reply to this email to reach them.`,
    `Summary generated by MeetingMind, ${base}`,
  ];
  return { html, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n' };
}
