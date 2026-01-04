import { apiClient } from './client';
import type {
  CalendarProvider,
  ListCalendarConnectionsResponse,
  ConnectCalendarResponse,
  SyncCalendarsResponse,
} from '@/types/api';

export async function getCalendarConnections(): Promise<ListCalendarConnectionsResponse> {
  return apiClient<ListCalendarConnectionsResponse>('/api/calendar/connections');
}

export async function connectCalendar(
  provider: CalendarProvider
): Promise<ConnectCalendarResponse> {
  return apiClient<ConnectCalendarResponse>(`/api/calendar/connect/${provider}`, {
    method: 'POST',
  });
}

export async function disconnectCalendar(provider: CalendarProvider): Promise<void> {
  await apiClient(`/api/calendar/connections/${provider}`, {
    method: 'DELETE',
  });
}

export async function syncCalendars(): Promise<SyncCalendarsResponse> {
  return apiClient<SyncCalendarsResponse>('/api/calendar/sync', {
    method: 'POST',
  });
}
