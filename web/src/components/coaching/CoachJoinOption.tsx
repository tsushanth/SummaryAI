'use client';

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { COACH_PERSONA, COACH_TEXT, sessionsLeftText } from '@/lib/coaching/messages';

interface CoachJoinOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Sessions left; undefined while unknown. */
  balance: number | undefined;
  failed: boolean;
  onReload: () => void;
  /** The chosen meeting language has slow live captions. */
  delayedCaptions: boolean;
}

/** The AI Coach switch on the join form. There is no way to buy sessions on the web, so none is offered. */
export function CoachJoinOption({ checked, onChange, balance, failed, onReload, delayedCaptions }: CoachJoinOptionProps) {
  const available = (balance ?? 0) > 0;
  const on = checked && available;

  return (
    <div className={cn('rounded-md border p-3', on ? 'border-primary/50' : 'border-border')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-[28px] items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            checked={on}
            disabled={!available}
            onChange={(e) => onChange(e.target.checked)}
            className="rounded border-input"
          />
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          {COACH_TEXT.title}
        </label>
        <span className="text-xs text-muted-foreground" role="status">
          {balance !== undefined ? (
            sessionsLeftText(balance)
          ) : failed ? (
            <>
              {COACH_TEXT.sessionsUnknown}{' '}
              <button type="button" onClick={onReload} className="font-semibold text-primary underline">
                {COACH_TEXT.retry}
              </button>
            </>
          ) : (
            COACH_TEXT.checkingSessions
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{COACH_PERSONA.label}</p>
      {on && (
        <p className="mt-2 text-xs text-muted-foreground">
          {delayedCaptions ? COACH_TEXT.delayedLanguage : COACH_TEXT.joinHint} {COACH_TEXT.joinNowOnly}
        </p>
      )}
    </div>
  );
}
