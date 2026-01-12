import { apiClient } from './client';
import type {
  ListMeetingsResponse,
  CreateMeetingRequest,
  CreateMeetingResponse,
  UpdateMeetingRequest,
  UpdateMeetingResponse,
  Meeting,
  LiveTranscriptResponse,
  LiveInsightsResponse,
  LiveInsightType,
} from '@/types/api';

export async function getMeetings(params?: {
  limit?: number;
  offset?: number;
  status?: 'upcoming' | 'past' | 'all';
  days_ahead?: number;
}): Promise<ListMeetingsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', params.limit.toString());
  if (params?.offset) searchParams.set('offset', params.offset.toString());
  if (params?.status) searchParams.set('status', params.status);
  if (params?.days_ahead) searchParams.set('days_ahead', params.days_ahead.toString());

  const query = searchParams.toString();
  return apiClient<ListMeetingsResponse>(
    `/api/meetings${query ? `?${query}` : ''}`
  );
}

export async function getMeeting(id: string): Promise<Meeting> {
  const response = await apiClient<{ meeting: Meeting }>(`/api/meetings/${id}`);
  return response.meeting;
}

export async function createMeeting(
  data: CreateMeetingRequest
): Promise<CreateMeetingResponse> {
  return apiClient<CreateMeetingResponse>('/api/meetings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateMeeting(
  id: string,
  data: UpdateMeetingRequest
): Promise<UpdateMeetingResponse> {
  return apiClient<UpdateMeetingResponse>(`/api/meetings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteMeeting(id: string): Promise<void> {
  await apiClient(`/api/meetings/${id}`, {
    method: 'DELETE',
  });
}

/**
 * Get live transcript segments for a meeting in progress
 */
export async function getLiveTranscript(
  meetingId: string,
  since?: string
): Promise<LiveTranscriptResponse> {
  const searchParams = new URLSearchParams();
  if (since) searchParams.set('since', since);

  const query = searchParams.toString();
  return apiClient<LiveTranscriptResponse>(
    `/api/meetings/${meetingId}/live-transcript${query ? `?${query}` : ''}`
  );
}

/**
 * Get AI-generated insights for a meeting in progress
 */
export async function getLiveInsights(
  meetingId: string,
  type?: LiveInsightType
): Promise<LiveInsightsResponse> {
  const searchParams = new URLSearchParams();
  if (type) searchParams.set('type', type);

  const query = searchParams.toString();
  return apiClient<LiveInsightsResponse>(
    `/api/meetings/${meetingId}/live-insights${query ? `?${query}` : ''}`
  );
}
