'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { recordingCheckText, type HeldRecording } from '@/lib/recordingCheck';

interface RecordingCheckNoticeProps {
  held: HeldRecording;
  source: 'recording' | 'file';
  onKeepGoing?: () => void;
  onRecordAgain?: () => void;
  onUploadAnyway: () => void;
  /** False when this browser could not save a copy of the recording. */
  saved?: boolean;
}

/** Shown when a recording or file is held back from upload: says why, and what the user can do. */
export function RecordingCheckNotice({ held, source, onKeepGoing, onRecordAgain, onUploadAnyway, saved }: RecordingCheckNoticeProps) {
  const { title, message } = recordingCheckText(held, source, !!onKeepGoing, saved);
  return (
    <div role="alert" className="rounded-lg border border-warning/50 bg-warning/10 p-4">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
        {title}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onKeepGoing && (
          <Button size="sm" onClick={onKeepGoing}>
            Keep going
          </Button>
        )}
        {onRecordAgain && (
          <Button size="sm" variant="outline" onClick={onRecordAgain}>
            Record again
          </Button>
        )}
        {held.canUploadAnyway && (
          <Button size="sm" variant="outline" onClick={onUploadAnyway}>
            Upload anyway
          </Button>
        )}
      </div>
    </div>
  );
}
