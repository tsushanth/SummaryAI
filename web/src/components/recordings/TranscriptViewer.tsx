'use client';

import type { Transcript, TranscriptSegment } from '@/types/api';
import { formatDuration } from '@/lib/utils/audio';
import { cn } from '@/lib/utils/cn';

interface TranscriptViewerProps {
  transcript: Transcript;
  currentTime?: number;
  onSeek?: (time: number) => void;
}

const speakerColors = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-orange-100 text-orange-800',
  'bg-pink-100 text-pink-800',
];

export function TranscriptViewer({
  transcript,
  currentTime = 0,
  onSeek,
}: TranscriptViewerProps) {
  return (
    <div className="space-y-4">
      {transcript.segments.map((segment, index) => {
        const isActive =
          currentTime >= segment.start_time && currentTime < segment.end_time;

        return (
          <div
            key={segment.segment_id || index}
            className={cn(
              'p-3 rounded-lg transition-colors',
              isActive ? 'bg-blue-50' : 'hover:bg-gray-50'
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded',
                  speakerColors[segment.speaker_index % speakerColors.length]
                )}
              >
                {segment.speaker_label || `Speaker ${segment.speaker_index + 1}`}
              </span>
              <button
                onClick={() => onSeek?.(segment.start_time)}
                className="text-xs text-blue-600 hover:underline"
              >
                {formatDuration(segment.start_time)}
              </button>
            </div>
            <p className="text-gray-700 leading-relaxed">{segment.text}</p>
          </div>
        );
      })}
    </div>
  );
}
