'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import useSWR from 'swr';
import { getLiveTranscript, getLiveInsights } from '@/lib/api/meetings';
import type {
  LiveTranscriptSegment,
  LiveInsight,
  LiveInsightType,
} from '@/types/api';

/**
 * Hook for fetching live transcript segments with polling
 */
export function useLiveTranscript(meetingId: string, enabled = true) {
  const [segments, setSegments] = useState<LiveTranscriptSegment[]>([]);
  const lastTimestampRef = useRef<string | undefined>();

  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ['live-transcript', meetingId, lastTimestampRef.current] : null,
    () => getLiveTranscript(meetingId, lastTimestampRef.current),
    {
      refreshInterval: enabled ? 2000 : 0, // Poll every 2 seconds when enabled
      revalidateOnFocus: false,
      dedupingInterval: 1000,
    }
  );

  // Merge new segments with existing ones
  useEffect(() => {
    if (data?.segments && data.segments.length > 0) {
      setSegments((prev) => {
        const existingIds = new Set(prev.map((s) => s.id));
        const newSegments = data.segments.filter((s) => !existingIds.has(s.id));

        if (newSegments.length > 0) {
          // Update lastTimestamp for incremental fetching
          const lastSegment = newSegments[newSegments.length - 1];
          lastTimestampRef.current = lastSegment.created_at;

          return [...prev, ...newSegments].sort(
            (a, b) => a.start_timestamp - b.start_timestamp
          );
        }

        return prev;
      });
    }
  }, [data]);

  // Reset when meeting changes
  useEffect(() => {
    setSegments([]);
    lastTimestampRef.current = undefined;
  }, [meetingId]);

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  return {
    segments,
    isLoading,
    error,
    hasMore: data?.has_more ?? false,
    refresh,
  };
}

/**
 * Hook for fetching live AI insights with polling
 */
export function useLiveInsights(
  meetingId: string,
  type?: LiveInsightType,
  enabled = true
) {
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? ['live-insights', meetingId, type] : null,
    () => getLiveInsights(meetingId, type),
    {
      refreshInterval: enabled ? 5000 : 0, // Poll every 5 seconds when enabled
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  );

  const refresh = useCallback(() => {
    mutate();
  }, [mutate]);

  // Group insights by type
  const groupedInsights = {
    fact_checks: data?.insights.filter((i) => i.insight_type === 'fact_check') ?? [],
    key_points: data?.insights.filter((i) => i.insight_type === 'key_point') ?? [],
    questions: data?.insights.filter((i) => i.insight_type === 'question') ?? [],
    contradictions: data?.insights.filter((i) => i.insight_type === 'contradiction') ?? [],
  };

  return {
    insights: data?.insights ?? [],
    groupedInsights,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Combined hook for both live transcript and insights
 */
export function useLiveMeeting(meetingId: string, enabled = true) {
  const transcript = useLiveTranscript(meetingId, enabled);
  const insights = useLiveInsights(meetingId, undefined, enabled);

  return {
    transcript,
    insights,
    isLoading: transcript.isLoading || insights.isLoading,
    error: transcript.error || insights.error,
  };
}
