import * as React from 'react';
import { cn } from '@/lib/utils/cn';

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Selectable filter chip. Exposes selected state via aria-pressed; 44px tall hit area. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected = false, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
        'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground hover:bg-accent',
        className
      )}
      {...props}
    />
  )
);
Chip.displayName = 'Chip';

/** Small non-interactive status pill. */
export function StatusPill({
  className,
  tone = 'neutral',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'primary';
}) {
  const tones = {
    neutral: 'bg-secondary text-secondary-foreground',
    primary: 'bg-accent text-accent-foreground',
    success: 'bg-success/15 text-success',
    warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
    danger: 'bg-destructive/15 text-destructive',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
