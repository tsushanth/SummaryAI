import * as React from 'react';
import { cn } from '@/lib/utils/cn';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}

// Bar heights (px) of the quiet "room tone" drawn above an empty state.
const ROOM_TONE = [6, 10, 7, 14, 9, 6, 12, 8, 5, 10, 7, 6];

/** Empty or error state: a flat, nearly silent waveform instead of a round icon bubble. */
export function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-md flex-col items-start px-4 py-12 sm:px-8',
        className
      )}
    >
      <div aria-hidden="true" className="mb-5 flex items-center gap-3 text-muted-foreground">
        <span className="[&>svg]:h-6 [&>svg]:w-6">{icon}</span>
        <span className="flex h-4 items-center gap-[3px]">
          {ROOM_TONE.map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-border" style={{ height: h }} />
          ))}
        </span>
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {message ? (
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{message}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
