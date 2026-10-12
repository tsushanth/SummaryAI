import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/** Pulsing placeholder block. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

/** Skeleton rows approximating a list of cards. Announced to screen readers as loading. */
export function SkeletonCardList({
  count = 4,
  label = 'Loading',
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="space-y-2.5 rounded-xl border border-border/60 bg-card p-4"
        >
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
