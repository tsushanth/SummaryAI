import type { Recording, Summary, Transcript } from '@/types/api';

/**
 * Mirrors android ShareExporter (summaryMarkdown / transcriptMarkdown) so both
 * clients produce equivalent output. Speaker tokens ("Speaker N") are replaced
 * with custom names exactly like SpeakerNames.kt does.
 */

const SPEAKER_REGEX = /\bSpeaker\s+(\d+)\b/gi;

export function applySpeakerNames(text: string, names?: Record<string, string> | null): string {
  if (!names || Object.keys(names).length === 0) return text;
  return text.replace(SPEAKER_REGEX, (match, idx: string) => {
    const custom = names[idx]?.trim();
    return custom ? custom : match;
  });
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function summaryMarkdown(
  recording: Pick<Recording, 'title'>,
  summary: Summary,
  names?: Record<string, string> | null
): string {
  const a = (t: string) => applySpeakerNames(t, names);
  const lines: string[] = [`# ${recording.title}`, '', '## Summary', a(summary.summary)];
  if (summary.key_points?.length) {
    lines.push('', '## Key Points', ...summary.key_points.map((p) => `• ${a(p)}`));
  }
  if (summary.action_items?.length) {
    lines.push(
      '',
      '## Action Items',
      ...summary.action_items.map((i) => `• ${a(i.text)}${i.assignee ? ` (${i.assignee})` : ''}`)
    );
  }
  if (summary.topics?.length) {
    lines.push('', '## Topics', summary.topics.join(', '));
  }
  return lines.join('\n') + '\n';
}

export function transcriptMarkdown(
  recording: Pick<Recording, 'title'>,
  transcript: Transcript
): string {
  const names = transcript.speaker_names;
  const lines: string[] = [`# ${recording.title} - Transcript`, ''];
  for (const seg of transcript.segments) {
    const custom = names?.[String(seg.speaker_index)]?.trim();
    const speaker = custom || applySpeakerNames(seg.speaker_label || `Speaker ${seg.speaker_index + 1}`, names);
    lines.push(`[${mmss(seg.start_time)}] ${speaker}: ${applySpeakerNames(seg.text, names)}`, '');
  }
  return lines.join('\n');
}

/** Plain text: markdown headings reduced to upper-case-free plain lines. */
export function markdownToPlainText(md: string): string {
  return md.replace(/^#{1,6}\s+/gm, '');
}

export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Recording';
}

export function downloadTextFile(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Opens a print dialog on a minimal document (user picks "Save as PDF"). */
export function printAsPdf(title: string, markdown: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  const body = markdown
    .split('\n')
    .map((line) => {
      if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (!line.trim()) return '';
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join('\n');
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
      `<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;line-height:1.5;color:#111}` +
      `h1{font-size:22px}h2{font-size:17px;margin-top:22px}p{margin:6px 0}</style></head><body>${body}</body></html>`
  );
  w.document.close();
  w.focus();
  w.print();
}
