'use client';

import { useMemo, useState } from 'react';
import { Mail } from 'lucide-react';
import { emailSummary, type EmailSummaryResult } from '@/lib/api/organize';

const MAX_RECIPIENTS = 10;
const EMAIL_RE = /[^\s,;<>"'()]+@[^\s,;<>"'()]+\.[^\s,;<>"'()]+/g;

/** Pulls unique, lower-cased addresses out of anything pasted ("Ana <a@x.com>, b@y.com; ..."). */
export function parseRecipients(raw: string): string[] {
  const found = raw.match(EMAIL_RE) ?? [];
  return Array.from(new Set(found.map((e) => e.toLowerCase())));
}

/**
 * Email the summary (never the transcript) to people the owner types in. Each recipient
 * gets their own copy with Reply-To set to the owner. Sits next to the share-link panel.
 */
export function EmailSummaryPanel({ recordingId }: { recordingId: string }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EmailSummaryResult[] | null>(null);

  const recipients = useMemo(() => parseRecipients(raw), [raw]);
  const tooMany = recipients.length > MAX_RECIPIENTS;

  const send = async () => {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await emailSummary(recordingId, {
        recipients,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setResults(res.results);
      const failed = res.results.filter((r) => r.status === 'failed').map((r) => r.email);
      // Leave only the failed addresses so a retry does not email the others twice.
      setRaw(failed.join(', '));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  const sent = results?.filter((r) => r.status === 'sent').length ?? 0;
  const failed = results?.filter((r) => r.status === 'failed').length ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-md hover:bg-accent"
      >
        <Mail className="w-4 h-4" />
        Email summary
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-80 max-w-[calc(100vw-2rem)] bg-card border rounded-lg shadow-lg p-4 text-sm space-y-3">
          <p className="text-muted-foreground">
            Sends the summary, key points and action items (not the transcript). Each person gets their own copy and
            replies come to you.
          </p>
          <label className="block space-y-1">
            <span className="text-muted-foreground">To (paste or type emails)</span>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={3}
              placeholder="ana@example.com, ben@example.com"
              className="w-full rounded border border-input bg-card px-2 py-1 text-foreground"
            />
          </label>
          <p className={tooMany ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}>
            {tooMany
              ? `Up to ${MAX_RECIPIENTS} at a time (found ${recipients.length}).`
              : `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`}
          </p>
          <label className="block space-y-1">
            <span className="text-muted-foreground">Personal note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={2}
              className="w-full rounded border border-input bg-card px-2 py-1 text-foreground"
            />
          </label>
          <button
            onClick={send}
            disabled={busy || recipients.length === 0 || tooMany}
            className="w-full px-3 py-1.5 bg-primary text-primary-foreground rounded-md disabled:opacity-50"
          >
            {busy ? 'Sending…' : recipients.length === 1 ? 'Send to 1 person' : recipients.length > 1 ? `Send to ${recipients.length} people` : 'Send'}
          </button>

          {results && (
            <div className="rounded border border-border bg-muted p-2 text-xs text-foreground space-y-1">
              {sent > 0 && <div>Sent to {sent}.</div>}
              {failed > 0 && (
                <div className="text-destructive">
                  Could not send to: {results.filter((r) => r.status === 'failed').map((r) => r.email).join(', ')}. They
                  are left in the box to retry.
                </div>
              )}
            </div>
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      )}
    </div>
  );
}
