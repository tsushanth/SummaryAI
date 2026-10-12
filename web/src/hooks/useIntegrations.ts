'use client';

import useSWR from 'swr';
import { getIntegrations, getIntegrationDeliveries } from '@/lib/api/integrations';

export function useIntegrations() {
  const list = useSWR('integrations', getIntegrations);
  const log = useSWR('integration-deliveries', getIntegrationDeliveries);
  return {
    integrations: list.data ?? [],
    deliveries: log.data ?? [],
    isLoading: list.isLoading,
    error: list.error,
    refresh: async () => {
      await Promise.all([list.mutate(), log.mutate()]);
    },
  };
}
