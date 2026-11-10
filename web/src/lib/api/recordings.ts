import { toCreateRecordingBody, normalizeCreateRecordingResponse } from '@/lib/createRecordingBody';
import { apiClient } from './client';
import { UploadError, uploadFailureMessage, withUploadRetry } from '@/lib/uploadRetry';
import { recordingsQueryString, type RecordingsQueryParams } from '@/lib/recordingsQuery';
import type {
  CreateRecordingRequest,
  CreateRecordingResponse,
  GetRecordingResponse,
  ListRecordingsResponse,
  Recording,
  Transcript,
} from '@/types/api';

export async function createRecording(
  data: CreateRecordingRequest
): Promise<CreateRecordingResponse> {
  const raw = await apiClient<unknown>('/api/recordings', {
    method: 'POST',
    body: JSON.stringify(toCreateRecordingBody(data)),
  });
  return normalizeCreateRecordingResponse(raw);
}

/** One PUT attempt. Rejects with an UploadError carrying the storage status (0 = never completed). */
function putOnce(
  uploadInfo: { url: string; method: string; headers: Record<string, string> },
  file: File,
  onProgress?: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(uploadInfo.method, uploadInfo.url);

    Object.entries(uploadInfo.headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress((e.loaded / e.total) * 100);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new UploadError(xhr.status, uploadFailureMessage(xhr.status)));
      }
    };
    xhr.onerror = () => reject(new UploadError(0, uploadFailureMessage(0)));
    xhr.ontimeout = () => reject(new UploadError(0, uploadFailureMessage(0)));
    xhr.onabort = () => reject(new UploadError(0, uploadFailureMessage(0)));

    xhr.send(file);
  });
}

/** PUT the audio to the signed URL, retrying transient failures (network, 408/429/5xx) twice with a short backoff. */
export async function uploadAudio(
  uploadInfo: { url: string; method: string; headers: Record<string, string> },
  file: File,
  onProgress?: (progress: number) => void
): Promise<void> {
  return withUploadRetry(() => putOnce(uploadInfo, file, onProgress), { onRetry: () => onProgress?.(0) });
}

export async function completeUpload(recordingId: string): Promise<Recording> {
  const response = await apiClient<{ recording: Recording }>(
    `/api/recordings/${recordingId}/complete-upload`,
    {
      method: 'POST',
    }
  );
  return response.recording;
}

export async function getRecordings(params?: RecordingsQueryParams): Promise<ListRecordingsResponse> {
  const query = recordingsQueryString(params);
  return apiClient<ListRecordingsResponse>(
    `/api/recordings${query ? `?${query}` : ''}`
  );
}

export async function getRecording(
  id: string,
  include?: string[]
): Promise<GetRecordingResponse> {
  const params = include?.length ? `?include=${include.join(',')}` : '';
  return apiClient<GetRecordingResponse>(`/api/recordings/${id}${params}`);
}

export async function updateRecording(
  id: string,
  data: { title?: string; is_favorite?: boolean; tags?: string[] }
): Promise<Recording> {
  const response = await apiClient<{ recording: Recording }>(
    `/api/recordings/${id}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    }
  );
  return response.recording;
}

export async function deleteRecording(id: string): Promise<void> {
  await apiClient(`/api/recordings/${id}`, {
    method: 'DELETE',
  });
}

export async function updateSpeakerNames(
  recordingId: string,
  speakerNames: Record<string, string>
): Promise<Transcript> {
  const response = await apiClient<{ transcript: Transcript }>(
    `/api/recordings/${recordingId}/speakers`,
    {
      method: 'PATCH',
      body: JSON.stringify({ speaker_names: speakerNames }),
    }
  );
  return response.transcript;
}
