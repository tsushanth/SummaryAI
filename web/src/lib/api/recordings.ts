import { apiClient } from './client';
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
  return apiClient<CreateRecordingResponse>('/api/recordings', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function uploadAudio(
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
        reject(new Error('Upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));

    xhr.send(file);
  });
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

export async function getRecordings(params?: {
  page?: number;
  per_page?: number;
  status?: string;
}): Promise<ListRecordingsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', params.page.toString());
  if (params?.per_page) searchParams.set('per_page', params.per_page.toString());
  if (params?.status) searchParams.set('status', params.status);

  const query = searchParams.toString();
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
