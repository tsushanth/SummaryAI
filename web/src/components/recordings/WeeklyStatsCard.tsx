'use client';

import { Card, CardContent } from '@/components/ui/card';
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
    <Card className="mb-6">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Last 7 days</p>
        <dl className="grid grid-cols-3 gap-4">
          {items.map((i) => (
            <div key={i.label}>
              <dd className="text-2xl font-bold text-foreground">{i.value}</dd>
              <dt className="text-xs text-muted-foreground">{i.label}</dt>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
