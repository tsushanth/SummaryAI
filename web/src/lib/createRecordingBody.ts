import type { CreateRecordingRequest, CreateRecordingResponse } from '@/types/api';
import { sanitizeDurationSeconds } from './recordingDuration.ts';

/**
 * Body for POST /api/recordings. The backend schema (backend/src/routes/recordings.ts, createRecordingSchema) requires
 * `file_size_bytes`; callers in the web app say `file_size`. Without this mapping the API answers 400 VALIDATION_ERROR
 * ({"file_size_bytes":"Required"}) and no browser recording or upload can be created.
 */
export function toCreateRecordingBody(req: CreateRecordingRequest): Record<string, unknown> {
  const { file_size, duration_seconds, ...rest } = req;
  const body: Record<string, unknown> = { ...rest, file_size_bytes: file_size, duration_seconds: sanitizeDurationSeconds(duration_seconds) };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

/**
 * The backend answers POST /api/recordings with { recording, upload: {url, method, headers} } (Android reads `upload`); the web
 * types said `upload_info`, so even with a valid request the page got undefined and crashed. Accept both, fail loudly on neither.
 */
export function normalizeCreateRecordingResponse(raw: unknown): CreateRecordingResponse {
  const r = raw as { recording?: unknown; upload?: unknown; upload_info?: unknown };
  const upload_info = (r?.upload_info ?? r?.upload) as CreateRecordingResponse['upload_info'] | undefined;
  if (!r?.recording || !upload_info?.url) throw new Error('Unexpected response from the server: missing upload details');
  return { recording: r.recording as CreateRecordingResponse['recording'], upload_info };
}
