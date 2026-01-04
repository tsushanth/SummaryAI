import { apiClient } from './client';
import type {
  AskQuestionRequest,
  AskQuestionResponse,
  ListQuestionsResponse,
} from '@/types/api';

export async function askQuestion(
  recordingId: string,
  question: string
): Promise<AskQuestionResponse> {
  return apiClient<AskQuestionResponse>(
    `/api/recordings/${recordingId}/questions`,
    {
      method: 'POST',
      body: JSON.stringify({ question, include_context: true }),
    }
  );
}

export async function getQuestionHistory(
  recordingId: string
): Promise<ListQuestionsResponse> {
  return apiClient<ListQuestionsResponse>(
    `/api/recordings/${recordingId}/questions`
  );
}
