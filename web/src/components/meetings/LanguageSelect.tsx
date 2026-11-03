'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils/cn';
import { languageOptions } from '@/lib/transcriptionLanguages';

interface LanguageSelectProps {
  value: string;
  onChange: (code: string) => void;
  label: string;
  /** Text shown under the control and linked with aria-describedby (hints, why it is disabled). */
  description?: string | null;
  disabled?: boolean;
  className?: string;
  id?: string;
}

const OPTIONS = languageOptions();

/** Native <select>: keyboard, screen reader and mobile pickers work without extra code. */
export function LanguageSelect({ value, onChange, label, description, disabled, className, id }: LanguageSelectProps) {
  const auto = useId();
  const selectId = id ?? auto;
  const descId = `${selectId}-desc`;
  return (
    <div className={className}>
      <label htmlFor={selectId} className="block text-sm font-medium text-foreground/90 mb-1">
        {label}
      </label>
      <select
        id={selectId}
        value={value}
        disabled={disabled}
        aria-describedby={description ? descId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {description && (
        <p id={descId} className="mt-1 text-xs text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
