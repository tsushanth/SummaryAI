import * as React from 'react';
import { cn } from '@/lib/utils/cn';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Centered empty or error state with optional action. */
export function EmptyState({ icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-8 py-12 text-center',
        className
      )}
    >
      <div
        aria-hidden="true"
        className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground [&>svg]:h-8 [&>svg]:w-8"
      >
        {icon}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {message ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{message}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
