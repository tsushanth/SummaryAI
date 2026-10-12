'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import type { Recording, Summary, Transcript } from '@/types/api';
import {
  summaryMarkdown,
  transcriptMarkdown,
  liveTranscriptMarkdown,
  markdownToPlainText,
  safeFileName,
  downloadTextFile,
  printAsPdf,
  audioExtensionFor,
  audioDownloadUrl,
  DEFAULT_EXPORT_OPTIONS,
  type ExportOptions,
} from '@/lib/exportFormats';
import { getStitchedLiveTranscript } from '@/lib/exportLive';

interface ExportMenuProps {
  recording: Recording;
  summary?: Summary;
  transcript?: Transcript;
  /** Signed audio URL from the recording detail response */
  audioUrl?: string;
}

type Kind = 'summary' | 'transcript' | 'live';
type Format = 'md' | 'txt' | 'pdf' | 'copy';

const KIND_LABEL: Record<Kind, string> = {
  summary: 'Summary',
  transcript: 'Transcript',
  live: 'Live Transcript',
};

const OPTION_LABELS: { key: keyof ExportOptions; label: string }[] = [
  { key: 'includeSpeakerNames', label: 'Speaker names' },
  { key: 'includeTimestamps', label: 'Timestamps' },
  { key: 'includeActionItems', label: 'Action items' },
];

export function ExportMenu({ recording, summary, transcript, audioUrl }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const build = async (kind: Kind): Promise<string | null> => {
    if (kind === 'summary') {
      return summary ? summaryMarkdown(recording, summary, transcript?.speaker_names, options) : null;
    }
    if (kind === 'transcript') return transcript ? transcriptMarkdown(recording, transcript, options) : null;
    if (!recording.meeting_id) return null;
    try {
      const live = await getStitchedLiveTranscript(recording.meeting_id);
      return live.segments.length ? liveTranscriptMarkdown(recording, live, options) : null;
    } catch {
      return null;
    }
  };

  const run = async (kind: Kind, format: Format) => {
    setOpen(false);
    const md = await build(kind);
    if (!md) {
      showNotice(kind === 'live' ? 'No live transcript captured yet.' : `${KIND_LABEL[kind]} not ready yet.`);
      return;
    }
    const base = `${safeFileName(recording.title)} - ${KIND_LABEL[kind]}`;
    if (format === 'md') downloadTextFile(`${base}.md`, md, 'text/markdown');
    else if (format === 'txt') downloadTextFile(`${base}.txt`, markdownToPlainText(md));
    else if (format === 'pdf') printAsPdf(base, md);
    else {
      try {
        await navigator.clipboard.writeText(md);
        showNotice('Copied to clipboard');
      } catch {
        showNotice('Copy failed');
      }
    }
  };

  const formats: { id: Format; label: string }[] = [
    { id: 'md', label: 'Markdown' },
    { id: 'txt', label: 'Text' },
    { id: 'pdf', label: 'PDF (print)' },
    { id: 'copy', label: 'Copy' },
  ];

  const kinds: Kind[] = recording.meeting_id ? ['summary', 'transcript', 'live'] : ['summary', 'transcript'];

  const audioHref = audioUrl
    ? audioDownloadUrl(audioUrl, `${safeFileName(recording.title)}.${audioExtensionFor(audioUrl)}`)
    : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent"
      >
        <Download className="w-4 h-4" />
        Export
      </button>
      {notice && <span className="ml-2 text-xs text-muted-foreground">{notice}</span>}
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 bg-card border rounded-lg shadow-lg p-2 text-sm">
          <div className="mb-2 pb-2 border-b">
            <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">Include</div>
            {OPTION_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
          {kinds.map((kind) => (
            <div key={kind} className="mb-2">
              <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
                {KIND_LABEL[kind]}
              </div>
              {formats.map((f) => (
                <button
                  key={f.id}
                  onClick={() => run(kind, f.id)}
                  className="block w-full text-left px-2 py-1 rounded hover:bg-accent"
                >
                  {f.label}
                </button>
              ))}
            </div>
          ))}
          {audioHref && (
            <div className="pt-2 border-t">
              <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">Audio</div>
              <a
                href={audioHref}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="block w-full text-left px-2 py-1 rounded hover:bg-accent"
              >
                Download audio
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
