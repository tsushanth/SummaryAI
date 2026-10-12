import * as React from 'react';
import { cn } from '@/lib/utils/cn';

interface SectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}

/** Section title with optional leading icon and trailing action. */
export function SectionHeader({
  title,
  icon,
  action,
  as: Tag = 'h2',
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center gap-2 py-1', className)}>
      {icon ? (
        <span aria-hidden="true" className="text-primary [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </span>
      ) : null}
      <Tag className="flex-1 text-base font-semibold text-foreground">{title}</Tag>
      {action}
    </div>
  );
}
