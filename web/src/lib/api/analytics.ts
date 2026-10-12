import { apiClient } from './client';

export interface SpeakerStats {
  speaker_index: number;
  name: string;
  talk_time_seconds: number;
  talk_share: number; // 0..1
  word_count: number;
  question_count: number;
  longest_monologue_seconds: number;
}

export interface MeetingAnalytics {
  speakers: SpeakerStats[];
  total_talk_seconds: number;
  total_words: number;
  total_questions: number;
  longest_monologue_seconds: number;
  longest_monologue_speaker: string | null;
  basis: 'time' | 'words';
}

export async function getRecordingAnalytics(id: string): Promise<MeetingAnalytics> {
  const r = await apiClient<{ analytics: MeetingAnalytics }>(`/api/recordings/${id}/analytics`);
  return r.analytics;
}

export interface WeeklyStats {
  since: string;
  meetings: number;
  seconds_recorded: number;
  hours_recorded: number;
  action_items: number;
}

export async function getWeeklyStats(): Promise<WeeklyStats> {
  return apiClient<WeeklyStats>('/api/stats/weekly');
}
