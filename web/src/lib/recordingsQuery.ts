/** Query string for GET /api/recordings. No runtime imports (unit-tested in node). */
export interface RecordingsQueryParams {
  page?: number;
  per_page?: number;
  status?: string;
  folder_id?: string;
  tag?: string;
  favorite?: boolean;
  recording_type?: string;
  from?: string;
  to?: string;
}

export function recordingsQueryString(params?: RecordingsQueryParams): string {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', params.page.toString());
  if (params?.per_page) sp.set('per_page', params.per_page.toString());
  if (params?.status) sp.set('status', params.status);
  if (params?.folder_id) sp.set('folder_id', params.folder_id);
  if (params?.tag) sp.set('tag', params.tag);
  if (params?.favorite !== undefined) sp.set('favorite', String(params.favorite));
  if (params?.recording_type) sp.set('recording_type', params.recording_type);
  if (params?.from) sp.set('from', params.from);
  if (params?.to) sp.set('to', params.to);
  return sp.toString();
}
