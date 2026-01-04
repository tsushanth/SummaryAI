'use client';

import useSWR from 'swr';
import { useState, useCallback } from 'react';
import {
  getCalendarConnections,
  connectCalendar,
  disconnectCalendar,
  syncCalendars,
} from '@/lib/api/calendar';
import type { CalendarProvider } from '@/types/api';

// Global message handler for OAuth callbacks
type OAuthMessageHandler = (event: MessageEvent) => void;
let globalOAuthHandler: OAuthMessageHandler | null = null;

function setOAuthMessageHandler(handler: OAuthMessageHandler | null) {
  // Remove old handler if exists
  if (globalOAuthHandler) {
    window.removeEventListener('message', globalOAuthHandler);
  }
  globalOAuthHandler = handler;
  if (handler) {
    window.addEventListener('message', handler);
  }
}

export function useCalendarConnections() {
  const { data, error, isLoading, mutate } = useSWR(
    'calendar-connections',
    () => getCalendarConnections(),
    {
      revalidateOnFocus: true,
    }
  );

  return {
    connections: data?.connections ?? [],
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useConnectCalendar() {
  const [isConnecting, setIsConnecting] = useState(false);
  const { refresh } = useCalendarConnections();

  const connect = useCallback(
    async (provider: CalendarProvider) => {
      setIsConnecting(true);
      try {
        const { auth_url } = await connectCalendar(provider);

        // Open OAuth popup
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
          auth_url,
          'calendar-oauth',
          `width=${width},height=${height},left=${left},top=${top},popup=yes`
        );

        // Listen for postMessage from OAuth callback page
        const messageHandler = (event: MessageEvent) => {
          // Check if message is from our OAuth flow
          if (event.data?.type === 'calendar-connected' || event.data?.type === 'calendar-error') {
            setOAuthMessageHandler(null); // Remove handler
            setIsConnecting(false);
            refresh();

            // Close popup if still open
            if (popup && !popup.closed) {
              popup.close();
            }
          }
        };
        setOAuthMessageHandler(messageHandler);

        // Also poll for popup close (fallback)
        const pollTimer = setInterval(() => {
          if (popup?.closed) {
            clearInterval(pollTimer);
            setOAuthMessageHandler(null);
            setIsConnecting(false);
            // Refresh connections after popup closes
            refresh();
          }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(pollTimer);
          setOAuthMessageHandler(null);
          setIsConnecting(false);
        }, 300000);
      } catch (error) {
        setIsConnecting(false);
        throw error;
      }
    },
    [refresh]
  );

  return {
    connect,
    isConnecting,
  };
}

export function useDisconnectCalendar() {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const { refresh } = useCalendarConnections();

  const disconnect = useCallback(
    async (provider: CalendarProvider) => {
      setIsDisconnecting(true);
      try {
        await disconnectCalendar(provider);
        await refresh();
      } finally {
        setIsDisconnecting(false);
      }
    },
    [refresh]
  );

  return {
    disconnect,
    isDisconnecting,
  };
}

export function useSyncCalendars() {
  const [isSyncing, setIsSyncing] = useState(false);
  const { refresh } = useCalendarConnections();

  const sync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const result = await syncCalendars();
      await refresh();
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [refresh]);

  return {
    sync,
    isSyncing,
  };
}
