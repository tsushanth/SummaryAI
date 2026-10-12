import type { Recording, StitchedLiveTranscript, Summary, Transcript } from '@/types/api';

/**
 * Mirrors android ShareExporter (summaryMarkdown / transcriptMarkdown /
 * liveTranscriptMarkdown) so both clients produce equivalent output. Speaker
 * tokens ("Speaker N") are replaced with custom names exactly like
 * SpeakerNames.kt does.
 *
 * The pure formatters here are unit-tested by scripts/export.test.mjs
 * (`npm run test:export`); keep this file free of runtime imports so node can
 * load it directly.
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

export interface ExportOptions {
  /** Replace "Speaker N" with custom names (default true) */
  includeSpeakerNames: boolean;
  /** Prefix transcript lines with [mm:ss] (default true) */
  includeTimestamps: boolean;
  /** Include the Action Items section in summaries (default true) */
  includeActionItems: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeSpeakerNames: true,
  includeTimestamps: true,
  includeActionItems: true,
};

export function summaryMarkdown(
  recording: Pick<Recording, 'title'>,
  summary: Summary,
  names?: Record<string, string> | null,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS
): string {
  const effective = options.includeSpeakerNames ? names : null;
  const a = (t: string) => applySpeakerNames(t, effective);
  const lines: string[] = [`# ${recording.title}`, '', '## Summary', a(summary.summary)];
  // Android appends the detailed summary under the short one when present.
  if (summary.detailed_summary?.trim()) {
    lines.push('', a(summary.detailed_summary));
  }
  if (summary.key_points?.length) {
    lines.push('', '## Key Points', ...summary.key_points.map((p) => `• ${a(p)}`));
  }
  if (options.includeActionItems && summary.action_items?.length) {
    lines.push(
      '',
      '## Action Items',
      ...summary.action_items.map((i) => `• ${a(i.text)}${i.assignee ? ` (${a(i.assignee)})` : ''}`)
    );
  }
  if (summary.topics?.length) {
    lines.push('', '## Topics', summary.topics.join(', '));
  }
  return lines.join('\n') + '\n';
}

function transcriptLine(ts: number, speaker: string, text: string, withTimestamp: boolean): string {
  return `${withTimestamp ? `[${mmss(ts)}] ` : ''}${speaker}: ${text}`;
}

export function transcriptMarkdown(
  recording: Pick<Recording, 'title'>,
  transcript: Transcript,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS
): string {
  const names = options.includeSpeakerNames ? transcript.speaker_names : null;
  const lines: string[] = [`# ${recording.title} - Transcript`, ''];
  for (const seg of transcript.segments) {
    const custom = names?.[String(seg.speaker_index)]?.trim();
    const speaker = custom || applySpeakerNames(seg.speaker_label || `Speaker ${seg.speaker_index + 1}`, names);
    lines.push(transcriptLine(seg.start_time, speaker, applySpeakerNames(seg.text, names), options.includeTimestamps), '');
  }
  return lines.join('\n');
}

/** Mirrors Android liveTranscriptMarkdown (stitched realtime transcript). */
export function liveTranscriptMarkdown(
  recording: Pick<Recording, 'title'>,
  live: StitchedLiveTranscript,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS
): string {
  const lines: string[] = [
    `# ${recording.title} - Live Transcript`,
    '',
    `_Captured live during the meeting. ${live.word_count} words, ${live.speaker_count} speakers._`,
    '',
  ];
  for (const seg of live.segments) {
    lines.push(transcriptLine(seg.start_time, seg.speaker_label, seg.text, options.includeTimestamps), '');
  }
  return lines.join('\n');
}

/**
 * File extension for downloaded audio. Signed URLs carry a JWT in the query
 * string, so strip the query before looking at the path (same trap Android handles).
 */
export function audioExtensionFor(url: string, contentType?: string | null): string {
  const path = url.split('?')[0].split('#')[0];
  const last = path.slice(path.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  const pathExt = dot >= 0 ? last.slice(dot + 1).toLowerCase() : '';
  if (/^[a-z0-9]{2,5}$/.test(pathExt)) return pathExt;
  switch (contentType?.split(';')[0].trim().toLowerCase()) {
    case 'audio/mp4':
    case 'audio/m4a':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/aac':
      return 'aac';
    case 'audio/webm':
      return 'webm';
    case 'audio/flac':
      return 'flac';
    default:
      return 'm4a';
  }
}

/**
 * Adds Supabase's `download=<filename>` param so the storage server responds
 * with Content-Disposition: attachment (the <a download> attribute is ignored
 * for cross-origin URLs). The signed URL itself comes from the recording detail API.
 */
export function audioDownloadUrl(signedUrl: string, filename: string): string {
  const u = new URL(signedUrl);
  u.searchParams.set('download', filename);
  return u.toString();
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
