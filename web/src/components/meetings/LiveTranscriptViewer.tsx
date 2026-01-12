'use client';

import { useEffect, useRef } from 'react';
import { Loader2, User, Crown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { LiveTranscriptSegment } from '@/types/api';

interface LiveTranscriptViewerProps {
  segments: LiveTranscriptSegment[];
  isLoading: boolean;
  autoScroll?: boolean;
}

// Speaker colors for visual distinction
const speakerColors = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-purple-100 text-purple-800',
  'bg-orange-100 text-orange-800',
  'bg-pink-100 text-pink-800',
  'bg-teal-100 text-teal-800',
  'bg-indigo-100 text-indigo-800',
  'bg-rose-100 text-rose-800',
];

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function LiveTranscriptViewer({
  segments,
  isLoading,
  autoScroll = true,
}: LiveTranscriptViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const speakerColorMap = useRef<Map<string, string>>(new Map());

  // Get color for a speaker
  const getSpeakerColor = (speakerId: string | null): string => {
    if (!speakerId) return speakerColors[0];

    if (!speakerColorMap.current.has(speakerId)) {
      const colorIndex = speakerColorMap.current.size % speakerColors.length;
      speakerColorMap.current.set(speakerId, speakerColors[colorIndex]);
    }

    return speakerColorMap.current.get(speakerId)!;
  };

  // Auto-scroll to bottom when new segments arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [segments, autoScroll]);

  if (segments.length === 0 && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
        <User className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-sm">Waiting for transcript...</p>
        <p className="text-xs mt-1">Transcript will appear here as the meeting progresses</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-[400px] overflow-y-auto space-y-3 p-4 bg-gray-50 rounded-lg"
    >
      {segments.map((segment) => {
        const speakerName = segment.speaker_name || `Speaker ${segment.speaker_id || '?'}`;
        const colorClass = getSpeakerColor(segment.speaker_id);

        return (
          <div
            key={segment.id}
            className="flex gap-3 animate-fade-in"
          >
            {/* Timestamp */}
            <div className="flex-shrink-0 w-12 text-xs text-gray-400 pt-1">
              {formatTimestamp(segment.start_timestamp)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Speaker badge */}
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                    colorClass
                  )}
                >
                  {segment.is_host && <Crown className="w-3 h-3" />}
                  {speakerName}
                </span>
              </div>

              {/* Transcript text */}
              <p className="text-sm text-gray-700 leading-relaxed">
                {segment.segment_text}
              </p>
            </div>
          </div>
        );
      })}

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      )}
    </div>
  );
}
