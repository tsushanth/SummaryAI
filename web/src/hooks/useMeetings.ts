'use client';

import useSWR from 'swr';
import { useState, useCallback } from 'react';
import {
  getMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
} from '@/lib/api/meetings';
import type { CreateMeetingRequest, UpdateMeetingRequest } from '@/types/api';

export function useMeetings(params?: {
  limit?: number;
  offset?: number;
  status?: 'upcoming' | 'past' | 'all';
  days_ahead?: number;
}) {
  const { data, error, isLoading, mutate } = useSWR(
    ['meetings', params],
    () => getMeetings(params),
    {
      revalidateOnFocus: true,
      refreshInterval: (data) => {
        // Poll more frequently if any meeting is in active state
        const hasActiveMeeting = data?.items?.some(
          (m) =>
            m.status === 'bot_queued' ||
            m.status === 'bot_joining' ||
            m.status === 'bot_in_meeting'
        );
        return hasActiveMeeting ? 5000 : 30000;
      },
    }
  );

  return {
    meetings: data?.items ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useCreateMeeting() {
  const [isCreating, setIsCreating] = useState(false);
  const { refresh } = useMeetings();

  const create = useCallback(
    async (data: CreateMeetingRequest) => {
      setIsCreating(true);
      try {
        const result = await createMeeting(data);
        await refresh();
        return result;
      } finally {
        setIsCreating(false);
      }
    },
    [refresh]
  );

  return {
    create,
    isCreating,
  };
}

export function useUpdateMeeting() {
  const [isUpdating, setIsUpdating] = useState(false);
  const { refresh } = useMeetings();

  const update = useCallback(
    async (id: string, data: UpdateMeetingRequest) => {
      setIsUpdating(true);
      try {
        const result = await updateMeeting(id, data);
        await refresh();
        return result;
      } finally {
        setIsUpdating(false);
      }
    },
    [refresh]
  );

  return {
    update,
    isUpdating,
  };
}

export function useDeleteMeeting() {
  const [isDeleting, setIsDeleting] = useState(false);
  const { refresh } = useMeetings();

  const remove = useCallback(
    async (id: string) => {
      setIsDeleting(true);
      try {
        await deleteMeeting(id);
        await refresh();
      } finally {
        setIsDeleting(false);
      }
    },
    [refresh]
  );

  return {
    remove,
    isDeleting,
  };
}
