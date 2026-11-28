'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/components/auth/AuthProvider';
import { coachingApi, coachSession } from '@/lib/coaching/browser';

const subscribe = (listener: () => void) => coachSession().subscribe(listener);

/**
 * The AI Coach of a meeting being looked at. Picks up a session this tab does not know about (after a reload, or one
 * started elsewhere). Leaving the page does not end or disconnect it.
 */
export function useCoaching(meetingId: string | null | undefined, recordingId: string | null | undefined) {
  const state = useSyncExternalStore(
    subscribe,
    () => (meetingId ? coachSession().getState(meetingId) : null),
    () => null
  );

  useEffect(() => {
    if (meetingId && recordingId) void coachSession().attach(meetingId, recordingId);
  }, [meetingId, recordingId]);

  const stop = useCallback(() => meetingId && coachSession().stop(meetingId), [meetingId]);
  const retry = useCallback(() => meetingId && coachSession().retry(meetingId), [meetingId]);

  return { state, stop, retry };
}

/** Sessions left. Like the Android join screen, opening it claims the free sessions (granted once per account). */
export function useCoachingCredits() {
  const { user } = useAuth();
  const { data, error, isValidating, mutate } = useSWR(
    user ? ['coaching-credits', user.id] : null,
    async () => {
      await coachingApi.claimFreeCredits().catch(() => undefined);
      return coachingApi.getCredits();
    },
    { revalidateOnFocus: false }
  );

  return {
    /** Undefined while unknown. */
    balance: data,
    failed: data === undefined && !!error && !isValidating,
    reload: () => {
      void mutate();
    },
  };
}
