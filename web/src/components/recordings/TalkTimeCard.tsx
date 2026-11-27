'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { speakerColor } from '@/lib/utils/speakers';
import type { MeetingAnalytics } from '@/lib/api/analytics';
import { speakerDisplayName } from '@/lib/exportFormats';

function formatSeconds(s: number): string {
  const total = Math.round(s);
  return total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`;
}

/** Per-speaker talk share, words, questions and longest monologue. */
export function TalkTimeCard({ analytics }: { analytics: MeetingAnalytics }) {
  if (analytics.speakers.length === 0) return null;
  // The server sends the owner's name for a speaker, else the stored label counted from 0.
  const nameOf = (s: MeetingAnalytics['speakers'][number]) => speakerDisplayName(s.name, s.speaker_index);
  const longest = analytics.speakers.find((s) => s.name === analytics.longest_monologue_speaker);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Talk time</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="ribbon h-3 bg-muted"
          role="img"
          aria-label={analytics.speakers
            .map((s) => `${nameOf(s)} ${Math.round(s.talk_share * 100)}%`)
            .join(', ')}
        >
          {analytics.speakers.map((s) => (
            <div
              key={s.speaker_index}
              style={{ width: `${Math.max(0, s.talk_share * 100)}%`, backgroundColor: speakerColor(String(s.speaker_index)) }}
            />
          ))}
        </div>
        <ul className="space-y-3">
          {analytics.speakers.map((s) => (
            <li key={s.speaker_index}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-[2px]"
                    style={{ backgroundColor: speakerColor(String(s.speaker_index)) }}
                    aria-hidden="true"
                  />
                  {nameOf(s)}
                </span>
                <span className="font-semibold tabular">{Math.round(s.talk_share * 100)}%</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {s.word_count} words, {s.question_count} questions
              </p>
            </li>
          ))}
        </ul>
        {analytics.longest_monologue_speaker && analytics.longest_monologue_seconds > 0 && (
          <p className="text-xs text-muted-foreground">
            Longest monologue: {longest ? nameOf(longest) : analytics.longest_monologue_speaker} ({formatSeconds(analytics.longest_monologue_seconds)})
          </p>
        )}
      </CardContent>
    </Card>
  );
}
