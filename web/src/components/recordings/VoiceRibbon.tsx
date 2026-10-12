'use client';

import { useMemo } from 'react';
import type { TranscriptSegment } from '@/types/api';
import { speakerColor } from '@/lib/utils/speakers';
import { formatDuration } from '@/lib/utils/audio';
import { cn } from '@/lib/utils/cn';

interface TimelineProps {
  segments: TranscriptSegment[];
  speakerNames?: Record<string, string>;
  currentTime?: number;
  onSeek?: (time: number) => void;
  className?: string;
}

/**
 * Speaker timeline: one bar across the meeting, each stretch colored by who was speaking.
 * Built from real transcript segments. Clicking a stretch seeks the player there.
 */
export function SpeakerTimeline({ segments, speakerNames, currentTime = 0, onSeek, className }: TimelineProps) {
  const { total, runs } = useMemo(() => {
    const sorted = [...segments].sort((a, b) => a.start_time - b.start_time);
    const end = sorted.reduce((m, s) => Math.max(m, s.end_time), 0);
    // Merge adjacent segments of the same speaker so the bar stays light in the DOM.
    const merged: { speaker: number; start: number; end: number }[] = [];
    for (const s of sorted) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === s.speaker_index && s.start_time - last.end <= 1.5) {
        last.end = Math.max(last.end, s.end_time);
      } else {
        merged.push({ speaker: s.speaker_index, start: s.start_time, end: s.end_time });
      }
    }
    return { total: end, runs: merged };
  }, [segments]);

  if (total <= 0 || runs.length === 0) return null;
  const nameOf = (i: number) => speakerNames?.[String(i)] || `Speaker ${i + 1}`;
  const playhead = Math.min(100, Math.max(0, (currentTime / total) * 100));

  return (
    <div className={cn('relative', className)}>
      <div className="relative h-8 w-full overflow-hidden rounded-sm bg-muted" role="group" aria-label="Speaker timeline">
        {runs.map((r, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSeek?.(r.start)}
            disabled={!onSeek}
            title={`${nameOf(r.speaker)}, ${formatDuration(r.start)}`}
            aria-label={`${nameOf(r.speaker)} at ${formatDuration(r.start)}`}
            className="absolute inset-y-0 border-r border-background/60 focus-visible:z-10 disabled:cursor-default"
            style={{
              left: `${(r.start / total) * 100}%`,
              width: `${Math.max(0.4, ((r.end - r.start) / total) * 100)}%`,
              backgroundColor: speakerColor(String(r.speaker)),
            }}
          />
        ))}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: `${playhead}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular">
        <span>0:00</span>
        <span>{formatDuration(total)}</span>
      </div>
    </div>
  );
}

/** Who was in the room: one swatch per speaker (the list API only knows the count). */
export function VoiceSwatches({ count, className }: { count: number | null | undefined; className?: string }) {
  const n = Math.min(Math.max(count ?? 0, 0), 6);
  if (n === 0) return null;
  return (
    <span className={cn('flex items-center gap-[3px]', className)} role="img" aria-label={`${count} speaker${count === 1 ? '' : 's'}`}>
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} className="h-4 w-1.5 rounded-[2px]" style={{ backgroundColor: speakerColor(String(i)) }} />
      ))}
      {(count ?? 0) > 6 && <span className="ml-1 text-xs text-muted-foreground tabular">+{(count ?? 0) - 6}</span>}
    </span>
  );
}
