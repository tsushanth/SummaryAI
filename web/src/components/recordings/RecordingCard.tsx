'use client';

import Link from 'next/link';
import { formatDuration, formatRelativeDate } from '@/lib/utils/audio';
import { StatusBadge } from './StatusBadge';
import type { Recording } from '@/types/api';
import { Star, Clock, FileText } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export function RecordingCard({ recording }: { recording: Recording }) {
  return (
    <Link
      href={`/recordings/${recording.id}`}
      className="block rounded-xl border border-border/60 bg-card p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium truncate">{recording.title}</h3>
            {recording.is_favorite && (
              <Star className="w-4 h-4 text-amber-500 fill-amber-500 flex-shrink-0" role="img" aria-label="Favorite" />
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" aria-hidden="true" />
              {formatDuration(recording.duration_seconds)}
            </span>
            {recording.word_count && (
              <span className="flex items-center gap-1">
                <FileText className="w-4 h-4" aria-hidden="true" />
                {recording.word_count.toLocaleString()} words
              </span>
            )}
            <span>{formatRelativeDate(recording.created_at)}</span>
          </div>
        </div>
        <StatusBadge status={recording.status} />
      </div>
      {recording.tags && recording.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {recording.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-secondary text-secondary-foreground text-xs rounded-md"
            >
              {tag}
            </span>
          ))}
          {recording.tags.length > 3 && (
            <span className="px-2 py-0.5 text-muted-foreground text-xs">
              +{recording.tags.length - 3} more
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
