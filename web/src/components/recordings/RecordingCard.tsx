'use client';

import Link from 'next/link';
import { formatDuration, formatRelativeDate } from '@/lib/utils/audio';
import { StatusBadge, isLiveRecording } from './StatusBadge';
import { VoiceSwatches } from './VoiceRibbon';
import type { Recording } from '@/types/api';
import { Star } from 'lucide-react';

/** One row of the ledger: title, when, how long, who was there. */
export function RecordingCard({ recording }: { recording: Recording }) {
  return (
    <Link
      href={`/recordings/${recording.id}`}
      className="group block rounded-md border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  );
}
