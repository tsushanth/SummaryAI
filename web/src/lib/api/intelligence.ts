import { apiClient } from './client';
import type {
  ActionItemsToTodosResponse,
  CrossMeetingChatResponse,
  FollowUpEmail,
  SummaryTemplatesResponse,
} from '@/types/api';

export function getSummaryTemplates(): Promise<SummaryTemplatesResponse> {
  return apiClient<SummaryTemplatesResponse>('/api/summary-templates');
}

export async function setDefaultSummaryTemplate(template: string): Promise<string> {
  const res = await apiClient<{ default_template: string }>('/api/summary-templates/default', {
    method: 'PUT',
    body: JSON.stringify({ template }),
  });
  return res.default_template;
}

/** Replaces the stored summary with one generated from the given template. */
export function regenerateSummary(recordingId: string, template: string): Promise<{ template: string }> {
  return apiClient<{ template: string }>(`/api/recordings/${recordingId}/regenerate-summary`, {
    method: 'POST',
    body: JSON.stringify({ template }),
  });
}

export function draftFollowUpEmail(recordingId: string): Promise<FollowUpEmail> {
  return apiClient<FollowUpEmail>(`/api/recordings/${recordingId}/follow-up-email`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function actionItemsToTodos(recordingId: string): Promise<ActionItemsToTodosResponse> {
  return apiClient<ActionItemsToTodosResponse>(`/api/recordings/${recordingId}/action-items-to-todos`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function chatAcrossMeetings(question: string): Promise<CrossMeetingChatResponse> {
  return apiClient<CrossMeetingChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}
