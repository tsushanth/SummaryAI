'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Languages } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LanguageSelect } from '@/components/meetings/LanguageSelect';
import { getTranscriptionLanguages, setDefaultTranscriptionLanguage } from '@/lib/api/meetings';
import { languageChoiceHint, normalizeChoice } from '@/lib/transcriptionLanguages';

/** Settings card: the language new meetings are transcribed in unless you pick another one for a specific meeting. */
export function DefaultLanguageCard() {
  const { data, mutate } = useSWR('transcription-languages', getTranscriptionLanguages, { revalidateOnFocus: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (!data) return null;
  const value = normalizeChoice(data.default_language);

  const choose = async (code: string) => {
    if (code === value || saving) return;
    setError(false);
    setSaving(true);
    try {
      await mutate(
        async () => {
          await setDefaultTranscriptionLanguage(code);
          return { ...data, default_language: code };
        },
        { optimisticData: { ...data, default_language: code }, rollbackOnError: true, revalidate: false }
      );
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Languages className="h-5 w-5" aria-hidden="true" />
          Meeting language
        </CardTitle>
        <CardDescription>
          The language new meetings are transcribed in. Auto-detect works for most meetings; pick a language if yours is always the same.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LanguageSelect
          label="Default meeting language"
          value={value}
          onChange={choose}
          disabled={saving}
          description={languageChoiceHint(value, data.live)}
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Could not save your default. Try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
