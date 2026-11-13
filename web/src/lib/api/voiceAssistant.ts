import { apiClient } from './client';
import type { VoiceAssistantState } from '@/lib/voiceAssistant';

export function getVoiceAssistant(): Promise<VoiceAssistantState> {
  return apiClient<VoiceAssistantState>('/api/voice-assistant');
}

export function setVoiceAssistant(enabled: boolean): Promise<VoiceAssistantState> {
  return apiClient<VoiceAssistantState>('/api/voice-assistant', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}
