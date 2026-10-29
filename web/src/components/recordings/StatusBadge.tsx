import { cn } from '@/lib/utils/cn';
import type { Recording, RecordingStatus } from '@/types/api';

const statusConfig: Record<
  RecordingStatus,
  { label: string; className: string }
> = {
  pending: { label: 'Pending', className: 'bg-secondary text-secondary-foreground' },
  uploading: { label: 'Uploading', className: 'bg-mark text-mark-foreground' },
  uploaded: { label: 'Processing', className: 'bg-accent text-accent-foreground' },
  transcribing: { label: 'Transcribing', className: 'bg-accent text-accent-foreground' },
  transcribed: { label: 'Summarizing', className: 'bg-accent text-accent-foreground' },
  summarizing: { label: 'Summarizing', className: 'bg-accent text-accent-foreground' },
  completed: { label: 'Completed', className: 'bg-success/15 text-success' },
  failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive' },
};

/**
 * A meeting-bot recording stays 'uploading' for the whole call (the webhook sets it when the
 * bot starts recording) and moves to 'uploaded' once the media is finalised. A manual upload
 * is also 'uploading' but has no meeting, so the meeting link tells the two apart.
 */
export function isLiveRecording(recording: Pick<Recording, 'status' | 'meeting_id'>): boolean {
  return recording.status === 'uploading' && !!recording.meeting_id;
}

export function StatusBadge({ status, live = false }: { status: RecordingStatus; live?: boolean }) {
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-xs font-semibold bg-destructive/15 text-destructive">
        <span className="h-2 w-2 rounded-full bg-destructive animate-pulse motion-reduce:animate-none" aria-hidden="true" />
        Recording
      </span>
    );
  }
  const config = statusConfig[status] || statusConfig.completed;

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-semibold',
        config.className
      )}
    >
      {config.label}
    </span>
  );
}
