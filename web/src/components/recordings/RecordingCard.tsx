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
      className="block bg-white rounded-lg border shadow-sm hover:shadow-md transition-shadow p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium truncate">{recording.title}</h3>
            {recording.is_favorite && (
              <Star className="w-4 h-4 text-yellow-500 fill-yellow-500 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {formatDuration(recording.duration_seconds)}
            </span>
            {recording.word_count && (
              <span className="flex items-center gap-1">
                <FileText className="w-4 h-4" />
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
              className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded"
            >
              {tag}
            </span>
          ))}
          {recording.tags.length > 3 && (
            <span className="px-2 py-0.5 text-gray-400 text-xs">
              +{recording.tags.length - 3} more
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
