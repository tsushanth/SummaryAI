'use client';

import useSWR from 'swr';
import { getRecordingAnalytics, getWeeklyStats } from '@/lib/api/analytics';

/** `version` changes (e.g. speaker renames) force a refetch. */
export function useRecordingAnalytics(id: string | null, enabled = true, version = '') {
  const { data, error, isLoading } = useSWR(
    id && enabled ? ['analytics', id, version] : null,
    () => getRecordingAnalytics(id!),
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
  return { analytics: data, error, isLoading };
}

export function useWeeklyStats() {
  const { data, error, isLoading } = useSWR('weekly-stats', getWeeklyStats, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return { stats: data, error, isLoading };
}
