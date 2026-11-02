'use client';

import { useState } from 'react';
import { useSWRConfig } from 'swr';
import { Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { deleteRecording } from '@/lib/api/recordings';
import { deleteConfirmMessage, deleteRecordingThenRefresh, isRecordingDataKey } from '@/lib/recordingDelete';

interface DeleteRecordingDialogProps {
  recording: { id: string; title: string };
  open: boolean;
  onClose: () => void;
  /** Called after the recording was deleted and the lists were refreshed (e.g. to leave the detail page). */
  onDeleted?: () => void;
}

/** Confirmation dialog for permanently deleting one recording (detail page and list-row menu). */
export function DeleteRecordingDialog({ recording, open, onClose, onDeleted }: DeleteRecordingDialogProps) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await deleteRecordingThenRefresh(recording.id, {
      remove: deleteRecording,
      refresh: () => mutate(isRecordingDataKey),
    });
    setBusy(false);
    if (result.ok) {
      onClose();
      onDeleted?.();
    } else {
      setError(result.message);
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Delete recording?">
      <p className="text-sm text-muted-foreground">{deleteConfirmMessage(recording.title)}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={confirm} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Delete
        </Button>
      </div>
    </Dialog>
  );
}
