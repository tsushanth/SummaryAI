'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mail, RefreshCw, Sparkles } from 'lucide-react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { getSummaryTemplates, regenerateSummary } from '@/lib/api/intelligence';
import { FollowUpEmailDialog } from './FollowUpEmailDialog';

interface Props {
  recordingId: string;
  /** Template stored on the recording, if the API returned one. */
  currentTemplate?: string | null;
  /** Called after a successful regenerate so the page reloads the summary. */
  onRegenerated: () => void;
}

/** Summary style picker, confirm-before-regenerate, and the follow-up email entry point. */
export function SummaryTemplatePanel({ recordingId, currentTemplate, onRegenerated }: Props) {
  const { data } = useSWR('summary-templates', getSummaryTemplates, { revalidateOnFocus: false });
  const templates = data?.templates ?? [];

  const [applied, setApplied] = useState<string | null>(currentTemplate ?? null);
  const [picked, setPicked] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => {
    if (currentTemplate) setApplied(currentTemplate);
  }, [currentTemplate]);

  const selected = picked || applied || data?.default_template || '';
  const nameOf = (id: string | null) => templates.find((t) => t.id === id)?.name;
  const selectedTemplate = templates.find((t) => t.id === selected);

  const regenerate = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const res = await regenerateSummary(recordingId, selected);
      setApplied(res.template ?? selected);
      onRegenerated();
    } catch {
      setError('Could not regenerate the summary. Your existing summary is unchanged.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          Summary style
        </div>
        <p className="text-sm text-muted-foreground">
          {nameOf(applied) ? `Current: ${nameOf(applied)}` : 'Not set (uses your default)'}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="summary-template">
            Summary style
          </label>
          <select
            id="summary-template"
            value={selected}
            onChange={(e) => setPicked(e.target.value)}
            disabled={templates.length === 0 || busy}
            className="h-11 min-w-[12rem] rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <Button onClick={() => setConfirming(true)} disabled={!selected || busy}>
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {busy ? 'Regenerating...' : 'Regenerate summary'}
          </Button>
          <Button variant="outline" onClick={() => setEmailOpen(true)}>
            <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
            Draft follow-up email
          </Button>
        </div>
        {selectedTemplate?.description && (
          <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>

      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Regenerate summary?">
        <p className="text-sm text-muted-foreground">
          This replaces the current summary, key points and action items with a new{' '}
          {nameOf(selected) ?? selected} version. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button onClick={regenerate}>Regenerate</Button>
        </div>
      </Dialog>

      <FollowUpEmailDialog recordingId={recordingId} open={emailOpen} onClose={() => setEmailOpen(false)} />
    </Card>
  );
}
