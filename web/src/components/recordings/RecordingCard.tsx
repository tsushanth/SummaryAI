'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDuration, formatRelativeDate } from '@/lib/utils/audio';
import { StatusBadge, isLiveRecording } from './StatusBadge';
import { VoiceSwatches } from './VoiceRibbon';
import type { Recording } from '@/types/api';
import { MoreVertical, Star, Trash2 } from 'lucide-react';
import { canDeleteRecording } from '@/lib/recordingDelete';
import { DeleteRecordingDialog } from './DeleteRecordingDialog';

/** One row of the ledger: title, when, how long, who was there. */
export function RecordingCard({ recording }: { recording: Recording }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const deletable = canDeleteRecording(recording);

  // Close the row menu on outside click and Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <div className="relative">
      <Link
        href={`/recordings/${recording.id}`}
        className={`group block rounded-md border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${deletable ? 'pr-12' : ''}`}
      >
        <div className="flex items-start gap-3">
          <VoiceSwatches count={recording.speaker_count} className="mt-1 w-8 flex-shrink-0 flex-wrap" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="line-clamp-2 break-words text-base font-semibold tracking-tight">{recording.title}</h3>
              {recording.is_favorite && (
                <Star className="h-4 w-4 flex-shrink-0 fill-warning text-warning" role="img" aria-label="Favorite" />
              )}
            </div>
            <dl className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm text-muted-foreground tabular">
              <div className="flex gap-1">
                <dt className="sr-only">Recorded</dt>
                <dd>{formatRelativeDate(recording.created_at)}</dd>
              </div>
              <div className="flex gap-1">
                <dt className="sr-only">Length</dt>
                <dd>{isLiveRecording(recording) ? 'In progress' : formatDuration(recording.duration_seconds)}</dd>
              </div>
              {recording.word_count ? (
                <div className="flex gap-1">
                  <dd>{recording.word_count.toLocaleString()}</dd>
                  <dt>words</dt>
                </div>
              ) : null}
            </dl>
            {recording.tags && recording.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recording.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                    {tag}
                  </span>
                ))}
                {recording.tags.length > 3 && (
                  <span className="px-1 py-0.5 text-xs text-muted-foreground">+{recording.tags.length - 3} more</span>
                )}
              </div>
            )}
          </div>
          <StatusBadge status={recording.status} live={isLiveRecording(recording)} />
        </div>
      </Link>
      {deletable && (
        <div ref={menuRef} className="absolute right-1 top-2">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Actions for ${recording.title}`}
            className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-card p-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-sm px-3 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete recording
              </button>
            </div>
          )}
        </div>
      )}
      <DeleteRecordingDialog recording={recording} open={confirmOpen} onClose={() => setConfirmOpen(false)} />
    </div>
  );
}
