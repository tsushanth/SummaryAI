'use client';

import useSWR from 'swr';
import { getRecordings, getRecording } from '@/lib/api/recordings';
import type { RecordingsQueryParams } from '@/lib/recordingsQuery';
import { isInProgressStatus } from '@/lib/recordingStatus';

export function useRecordings(params?: RecordingsQueryParams) {
  const { data, error, isLoading, mutate } = useSWR(
    ['recordings', params],
    () => getRecordings(params),
    {
      revalidateOnFocus: true,
      refreshInterval: 30000,
    }
  );

  return {
    recordings: data?.recordings ?? [],
    meta: data?.meta,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useRecording(
  id: string | null,
  include: string[] = ['transcript', 'summary']
) {
  const { data, error, isLoading, mutate } = useSWR(
    id ? ['recording', id, include] : null,
    () => getRecording(id!, include),
    {
      refreshInterval: (data) => {
        // Poll more frequently while the recording is still moving through the pipeline (every non-terminal status)
        if (isInProgressStatus(data?.recording?.status)) {
          return 5000;
        }
        return 0;
      },
    }
  );

  return {
    recording: data?.recording,
    transcript: data?.transcript,
    summary: data?.summary,
    audioUrl: data?.audio_url,
    summaryStatus: data?.summary_status,
    summaryMinSeconds: data?.summary_min_seconds,
    isLoading,
    error,
    refresh: mutate,
  };
}
