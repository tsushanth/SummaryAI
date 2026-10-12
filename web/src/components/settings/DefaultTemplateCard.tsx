'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSummaryTemplates, setDefaultSummaryTemplate } from '@/lib/api/intelligence';

/** Settings card: default summary template used for new recordings. */
export function DefaultTemplateCard() {
  const { data, mutate } = useSWR('summary-templates', getSummaryTemplates, { revalidateOnFocus: false });
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!data) return null;

  const choose = async (id: string) => {
    if (id === data.default_template || saving) return;
    setError(false);
    setSaving(true);
    try {
      // Optimistic; rolls back by revalidating if the save fails
      await mutate(
        async () => {
          await setDefaultSummaryTemplate(id);
          return { ...data, default_template: id };
        },
        { optimisticData: { ...data, default_template: id }, rollbackOnError: true, revalidate: false }
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
          <Sparkles className="h-5 w-5" />
          Default summary style
        </CardTitle>
        <CardDescription>
          Used for new recordings unless you pick a style for a specific one
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset className="space-y-1" disabled={saving}>
          <legend className="sr-only">Default summary style</legend>
          {data.templates.map((t) => (
            <label
              key={t.id}
              className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-accent"
            >
              <input
                type="radio"
                name="default-template"
                value={t.id}
                checked={data.default_template === t.id}
                onChange={() => choose(t.id)}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="block text-xs text-muted-foreground">{t.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Could not save your default. Try again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
