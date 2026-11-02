'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSWRConfig } from 'swr';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createRecording, uploadAudio, completeUpload, deleteRecording } from '@/lib/api/recordings';
import {
  createIndexedDbStore,
  discardPendingAndStale,
  listPending,
  uploadWithPersistence,
  type PendingUpload,
} from '@/lib/pendingUpload';

/** Refresh the recordings list(s) after an upload or discard. */
const isRecordingsListKey = (key: unknown) => Array.isArray(key) && key[0] === 'recordings';

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Recordings made in this browser that were never fully uploaded (failed upload, closed tab, reload).
 * The audio is still stored in this browser; the user can retry the upload or discard it.
 */
export function PendingUploadsBanner() {
  const { mutate } = useSWRConfig();
  const [items, setItems] = useState<PendingUpload[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await listPending(createIndexedDbStore()));
    } catch {
      setItems([]); // IndexedDB unavailable: nothing was saved
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const retry = async (item: PendingUpload) => {
    setBusyId(item.id);
    setError(null);
    setProgress(0);
    try {
      await uploadWithPersistence(createIndexedDbStore(), item, {
        create: async (req) => {
          const { recording, upload_info } = await createRecording(req);
          return { recordingId: recording.id, uploadInfo: upload_info };
        },
        upload: (info, blob, onProgress) =>
          uploadAudio(info, new File([blob], item.fileName, { type: item.contentType }), onProgress),
        complete: completeUpload,
        discardStale: deleteRecording,
        onProgress: setProgress,
      });
      await mutate(isRecordingsListKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusyId(null);
      await reload();
    }
  };

  const discard = async (item: PendingUpload) => {
    if (!window.confirm(`Discard "${item.title || 'Untitled recording'}"? The audio saved in this browser will be deleted.`)) return;
    try {
      await discardPendingAndStale(createIndexedDbStore(), item, deleteRecording);
      await mutate(isRecordingsListKey);
    } finally {
      await reload();
    }
  };

  if (items.length === 0) return null;

  return (
    <section aria-label="Recordings waiting to upload" className="mb-6 rounded-md border border-warning/50 bg-warning/10 p-4">
      <div className="mb-2 flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
        {items.length === 1 ? 'A recording was not uploaded' : `${items.length} recordings were not uploaded`}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        The audio is saved in this browser. Retry the upload to get your transcript and summary.
      </p>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title || 'Untitled recording'}</p>
              <p className="text-xs text-muted-foreground tabular">
                {new Date(item.createdAt).toLocaleString()} · {formatSize(item.fileSize)}
                {busyId === item.id && progress > 0 ? ` · uploading ${Math.round(progress)}%` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => retry(item)} disabled={busyId !== null}>
                {busyId === item.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Retry upload
              </Button>
              <Button size="sm" variant="outline" onClick={() => discard(item)} disabled={busyId !== null}>
                Discard
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
