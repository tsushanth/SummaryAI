'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { CoachingInsight } from '@/lib/coaching/api';
import { COACH_TEXT, coachingCreditText, coachingStatusText, tipOffsetText } from '@/lib/coaching/messages';
import type { CoachingState } from '@/lib/coaching/session';

const URGENCY: Record<string, { dot: string; text: string; label: string }> = {
  now: { dot: 'bg-destructive', text: 'text-destructive', label: 'Now' },
  soon: { dot: 'bg-warning', text: 'text-warning', label: 'Soon' },
  'before-end': { dot: 'bg-success', text: 'text-success', label: 'Before the end' },
};

interface CoachPanelProps {
  state: CoachingState;
  onStop: () => void;
  onRetry: () => void;
  className?: string;
}

/** Live tips for a meeting with AI Coach on. Always says what the coach is doing, and why when it stops. */
export function CoachPanel({ state, onStop, onRetry, className }: CoachPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const status = coachingStatusText(state);
  const credit = coachingCreditText(state);
  const running = state.phase === 'live' || state.phase === 'reconnecting';

  return (
    <section aria-label={COACH_TEXT.title} className={cn('rounded-lg border border-primary/30 bg-card', className)}>
      <div className="flex items-center gap-2 py-1 pl-4 pr-1">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">{COACH_TEXT.title}</h2>
        {state.phase === 'live' && (
          <span className="flex items-center">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
            <span className="sr-only">Live</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {running && (
            <Button variant="ghost" size="sm" onClick={onStop}>
              {COACH_TEXT.stop}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show AI Coach tips' : 'Hide AI Coach tips'}
            className="flex h-10 w-10 items-center justify-center rounded-md hover:bg-accent"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="border-t border-border">
          <div role="status">
            {status && <p className="px-4 py-2 text-sm">{status}</p>}
            {credit && <p className="px-4 pb-2 text-sm text-muted-foreground">{credit}</p>}
          </div>
          {state.phase === 'not_started' && state.startFailure === 'other' && (
            <div className="px-4 pb-3">
              <Button variant="outline" size="sm" onClick={onRetry}>
                {COACH_TEXT.retry}
              </Button>
            </div>
          )}
          {state.insights.length === 0 && state.phase === 'live' && (
            <div className="space-y-1 px-4 py-3 text-sm text-muted-foreground">
              <p>{COACH_TEXT.listening}</p>
              <p>{COACH_TEXT.listeningHint}</p>
            </div>
          )}
          {/* Always mounted, so a screen reader announces tips as they are added. */}
          <ul
            aria-live="polite"
            aria-label="Coaching tips"
            tabIndex={state.insights.length ? 0 : undefined}
            className={cn('max-h-64 space-y-3 overflow-y-auto', state.insights.length && 'px-4 py-3')}
          >
            {state.insights.map((insight) => (
              <Tip key={insight.id} insight={insight} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Tip({ insight }: { insight: CoachingInsight }) {
  const urgency = URGENCY[insight.urgency] ?? URGENCY['before-end']!;
  const offset = tipOffsetText(insight.transcript_offset_seconds);
  return (
    <li className="flex items-start gap-3">
      <span className={cn('mt-1.5 h-2 w-2 flex-shrink-0 rounded-full', urgency.dot)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm">{insight.text}</p>
        <p className="mt-0.5 text-xs">
          <span className="sr-only">{urgency.label}: </span>
          <span className={cn('font-semibold capitalize', urgency.text)}>{insight.type}</span>
          {offset && <span className="text-muted-foreground"> · {offset}</span>}
        </p>
      </div>
    </li>
  );
}
