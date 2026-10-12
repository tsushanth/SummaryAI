'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import type { Recording, Summary, Transcript } from '@/types/api';
import {
  summaryMarkdown,
  transcriptMarkdown,
  markdownToPlainText,
  safeFileName,
  downloadTextFile,
  printAsPdf,
} from '@/lib/exportFormats';

interface ExportMenuProps {
  recording: Recording;
  summary?: Summary;
  transcript?: Transcript;
}

type Kind = 'summary' | 'transcript';
type Format = 'md' | 'txt' | 'pdf' | 'copy';

export function ExportMenu({ recording, summary, transcript }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const build = (kind: Kind): string | null => {
    if (kind === 'summary') return summary ? summaryMarkdown(recording, summary, transcript?.speaker_names) : null;
    return transcript ? transcriptMarkdown(recording, transcript) : null;
  };

  const run = async (kind: Kind, format: Format) => {
    const md = build(kind);
    setOpen(false);
    if (!md) {
      setNotice(`${kind === 'summary' ? 'Summary' : 'Transcript'} not ready yet.`);
      setTimeout(() => setNotice(null), 3000);
      return;
    }
    const base = `${safeFileName(recording.title)} - ${kind === 'summary' ? 'Summary' : 'Transcript'}`;
    if (format === 'md') downloadTextFile(`${base}.md`, md, 'text/markdown');
    else if (format === 'txt') downloadTextFile(`${base}.txt`, markdownToPlainText(md));
    else if (format === 'pdf') printAsPdf(base, md);
    else {
      try {
        await navigator.clipboard.writeText(md);
        setNotice('Copied to clipboard');
      } catch {
        setNotice('Copy failed');
      }
      setTimeout(() => setNotice(null), 3000);
    }
  };

  const formats: { id: Format; label: string }[] = [
    { id: 'md', label: 'Markdown' },
    { id: 'txt', label: 'Text' },
    { id: 'pdf', label: 'PDF (print)' },
    { id: 'copy', label: 'Copy' },
  ];

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
          {(['summary', 'transcript'] as Kind[]).map((kind) => (
            <div key={kind} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">{kind}</div>
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
        </div>
      )}
    </div>
  );
}
