import { apiClient } from './client';

export type IntegrationKind = 'webhook' | 'slack' | 'notion';

/** Public view only: secrets are write-only and never returned by the API. */
export interface IntegrationView {
  kind: IntegrationKind;
  enabled: boolean;
  configured: boolean;
  display_host: string | null;
  has_secret: boolean;
  database_id: string | null;
  last_status: string | null;
  last_error: string | null;
  last_delivered_at: string | null;
}

export interface IntegrationDelivery {
  id: string;
  kind: IntegrationKind;
  recording_id: string | null;
  event: string;
  status: string;
  attempts: number;
  response_status: number | null;
  error: string | null;
  created_at: string;
}

export interface SaveIntegrationInput {
  url?: string;
  secret?: string;
  database_id?: string;
  enabled?: boolean;
}

export async function getIntegrations(): Promise<IntegrationView[]> {
  const r = await apiClient<{ integrations: IntegrationView[] }>('/api/integrations');
  return r.integrations;
}

export async function getIntegrationDeliveries(): Promise<IntegrationDelivery[]> {
  const r = await apiClient<{ deliveries: IntegrationDelivery[] }>('/api/integrations/deliveries');
  return r.deliveries;
}

export async function saveIntegration(kind: IntegrationKind, input: SaveIntegrationInput): Promise<IntegrationView> {
  const r = await apiClient<{ integration: IntegrationView }>(`/api/integrations/${kind}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return r.integration;
}

export async function removeIntegration(kind: IntegrationKind): Promise<void> {
  await apiClient(`/api/integrations/${kind}`, { method: 'DELETE' });
}

export async function testIntegration(
  kind: IntegrationKind
): Promise<{ ok: boolean; response_status: number | null; error: string | null }> {
  return apiClient(`/api/integrations/${kind}/test`, { method: 'POST' });
}
