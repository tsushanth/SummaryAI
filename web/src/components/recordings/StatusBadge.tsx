import { cn } from '@/lib/utils/cn';
import type { RecordingStatus } from '@/types/api';

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

export function StatusBadge({ status }: { status: RecordingStatus }) {
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
