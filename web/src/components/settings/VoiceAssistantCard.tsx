'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Mic } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getVoiceAssistant, setVoiceAssistant } from '@/lib/api/voiceAssistant';
import { saveVoiceAssistant, switchOn, type VoiceAssistantState } from '@/lib/voiceAssistant';

const HINT =
  "When on, the meeting bot answers questions out loud when someone says 'Meeting Mind, ...'. Turn off to keep the bot silent.";

/** Settings card: switch for the in-meeting voice assistant (the bot that answers "Meeting Mind, ..." out loud). */
export function VoiceAssistantCard() {
  const { data, error: loadError, isLoading, mutate } = useSWR('voice-assistant', getVoiceAssistant, {
    revalidateOnFocus: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const checked = switchOn(data);
  const failedToLoad = !data && !!loadError;

  const toggle = async () => {
    if (!data || saving) return;
    setSaveFailed(false);
    setSaving(true);
    const { failed } = await saveVoiceAssistant(
      checked,
      !checked,
      setVoiceAssistant,
      // Show the new value at once; the same callback puts the old one back if the save fails
      (value) => void mutate({ ...data, preference: value } as VoiceAssistantState, { revalidate: false }),
    );
    setSaveFailed(failed);
    setSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5" aria-hidden="true" />
          Voice assistant in meetings
        </CardTitle>
        <CardDescription id="voice-assistant-hint">{HINT}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && !data && (
          <div role="status" aria-label="Loading voice assistant setting">
            <Skeleton className="h-6 w-11 rounded-full" />
            <span className="sr-only">Loading</span>
          </div>
        )}
        {data && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={checked}
              aria-labelledby="voice-assistant-label"
              aria-describedby="voice-assistant-hint"
              disabled={saving}
              onClick={toggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                checked ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 rounded-full bg-background shadow transition-transform ${
                  checked ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
            <span id="voice-assistant-label" className="text-sm font-medium text-foreground">
              {checked ? 'On' : 'Off'}
            </span>
          </div>
        )}
        {failedToLoad && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            <span>Could not load this setting. Check your connection.</span>
            <Button variant="outline" size="sm" onClick={() => void mutate()}>
              Retry
            </Button>
          </div>
        )}
        {saveFailed && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Could not save your change. Check your connection and try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
