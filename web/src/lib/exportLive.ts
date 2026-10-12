import { apiClient } from '@/lib/api/client';
import type { StitchedLiveTranscript } from '@/types/api';

/** Same source Android uses for "Share Live Transcript" (works mid-meeting). */
export function getStitchedLiveTranscript(meetingId: string): Promise<StitchedLiveTranscript> {
  return apiClient<StitchedLiveTranscript>(`/api/meetings/${meetingId}/live-transcript/stitched`);
}
