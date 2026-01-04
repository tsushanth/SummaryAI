'use client';

import useSWR from 'swr';
import { getRecordings, getRecording } from '@/lib/api/recordings';

export function useRecordings(params?: {
  page?: number;
  per_page?: number;
  status?: string;
}) {
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
        // Poll more frequently if still processing
        const status = data?.recording?.status;
        if (
          status === 'transcribing' ||
          status === 'summarizing' ||
          status === 'uploaded'
        ) {
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
    isLoading,
    error,
    refresh: mutate,
  };
}
