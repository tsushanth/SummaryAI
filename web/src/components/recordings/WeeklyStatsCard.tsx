'use client';

import { useWeeklyStats } from '@/hooks/useRecordingAnalytics';

/** "Last 7 days" summary on the recordings page. Hidden until loaded or when the request fails. */
export function WeeklyStatsCard() {
  const { stats } = useWeeklyStats();
  if (!stats) return null;
  const items = [
    { label: 'Meetings', value: String(stats.meetings) },
    { label: 'Hours recorded', value: stats.hours_recorded.toFixed(1) },
    { label: 'Action items', value: String(stats.action_items) },
  ];
  return (
    <section aria-label="Last 7 days" className="mb-6 rounded-lg bg-card px-4 py-3 sm:px-5">
      <h2 className="mb-1 text-sm font-semibold text-muted-foreground">Last 7 days</h2>
      <dl className="grid grid-cols-3 gap-4">
        {items.map((i) => (
          <div key={i.label} className="flex flex-col-reverse">
            <dd className="text-3xl font-semibold tracking-tight text-foreground tabular">{i.value}</dd>
            <dt className="text-sm text-muted-foreground">{i.label}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
