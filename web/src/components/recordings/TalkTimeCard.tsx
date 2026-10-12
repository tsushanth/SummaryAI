'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { speakerColor } from '@/lib/utils/speakers';
import type { MeetingAnalytics } from '@/lib/api/analytics';

function formatSeconds(s: number): string {
  const total = Math.round(s);
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
}

/** Per-speaker talk share, words, questions and longest monologue. */
export function TalkTimeCard({ analytics }: { analytics: MeetingAnalytics }) {
  if (analytics.speakers.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Talk time</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={analytics.speakers
            .map((s) => `${s.name} ${Math.round(s.talk_share * 100)}%`)
            .join(', ')}
        >
          {analytics.speakers.map((s) => (
            <div
              key={s.speaker_index}
              style={{ width: `${Math.max(0, s.talk_share * 100)}%`, backgroundColor: speakerColor(s.name) }}
            />
          ))}
        </div>
        <ul className="space-y-3">
          {analytics.speakers.map((s) => (
            <li key={s.speaker_index}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: speakerColor(s.name) }}
                    aria-hidden="true"
                  />
                  {s.name}
                </span>
                <span className="font-semibold">{Math.round(s.talk_share * 100)}%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {s.word_count} words · {s.question_count} questions
              </p>
            </li>
          ))}
        </ul>
        {analytics.longest_monologue_speaker && analytics.longest_monologue_seconds > 0 && (
          <p className="text-xs text-muted-foreground">
            Longest monologue: {analytics.longest_monologue_speaker} ({formatSeconds(analytics.longest_monologue_seconds)})
          </p>
        )}
      </CardContent>
    </Card>
  );
}
