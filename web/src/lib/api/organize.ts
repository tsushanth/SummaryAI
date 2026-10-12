import { apiClient } from './client';
import type { Recording } from '@/types/api';

export interface Folder {
  id: string;
  name: string;
  recording_count: number;
  created_at: string;
  updated_at: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ShareLink {
  id: string;
  recording_id: string;
  include_transcript: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export interface SearchResult {
  recording: Pick<
    Recording,
    'id' | 'title' | 'created_at' | 'duration_seconds' | 'status' | 'is_favorite' | 'tags'
  >;
  match: 'title' | 'summary' | 'transcript';
  snippet: string;
}

export async function getFolders(): Promise<Folder[]> {
  const res = await apiClient<{ folders: Folder[] }>('/api/folders');
  return res.folders;
}

export async function createFolder(name: string): Promise<Folder> {
  const res = await apiClient<{ folder: Folder }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return res.folder;
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const res = await apiClient<{ folder: Folder }>(`/api/folders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return res.folder;
}

export async function deleteFolder(id: string): Promise<void> {
  await apiClient(`/api/folders/${id}`, { method: 'DELETE' });
}

export async function getTags(): Promise<TagCount[]> {
  const res = await apiClient<{ tags: TagCount[] }>('/api/tags');
  return res.tags;
}

export async function moveRecordingToFolder(
  recordingId: string,
  folderId: string | null
): Promise<void> {
  await apiClient(`/api/recordings/${recordingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ folder_id: folderId }),
  });
}

export async function listShares(recordingId: string): Promise<ShareLink[]> {
  const res = await apiClient<{ shares: ShareLink[] }>(
    `/api/recordings/${recordingId}/shares`
  );
  return res.shares;
}

export async function createShare(
  recordingId: string,
  opts: { include_transcript: boolean; expires_in_days: number | null }
): Promise<{ share: ShareLink; token: string; url: string }> {
  return apiClient(`/api/recordings/${recordingId}/shares`, {
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export async function revokeShare(recordingId: string, shareId: string): Promise<void> {
  await apiClient(`/api/recordings/${recordingId}/shares/${shareId}`, {
    method: 'DELETE',
  });
}

export async function searchRecordings(q: string): Promise<SearchResult[]> {
  const res = await apiClient<{ results: SearchResult[] }>(
    `/api/search?q=${encodeURIComponent(q)}`
  );
  return res.results;
}
