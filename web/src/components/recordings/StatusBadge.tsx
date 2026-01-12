import { cn } from '@/lib/utils/cn';
import type { RecordingStatus } from '@/types/api';

const statusConfig: Record<
  RecordingStatus,
  { label: string; className: string }
> = {
  pending: { label: 'Pending', className: 'bg-gray-100 text-gray-800' },
  uploading: { label: 'Uploading', className: 'bg-yellow-100 text-yellow-800' },
  uploaded: { label: 'Processing', className: 'bg-blue-100 text-blue-800' },
  transcribing: { label: 'Transcribing', className: 'bg-blue-100 text-blue-800' },
  transcribed: { label: 'Summarizing', className: 'bg-purple-100 text-purple-800' },
  summarizing: { label: 'Summarizing', className: 'bg-purple-100 text-purple-800' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-800' },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-800' },
};

export function StatusBadge({ status }: { status: RecordingStatus }) {
  const config = statusConfig[status] || statusConfig.completed;

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        config.className
      )}
    >
      {config.label}
    </span>
  );
}
