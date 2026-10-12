'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Mail, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { draftFollowUpEmail } from '@/lib/api/intelligence';

interface Props {
  recordingId: string;
  open: boolean;
  onClose: () => void;
}

/** Drafts a follow-up email from the summary; subject and body are editable before copying or opening a mail client. */
export function FollowUpEmailDialog({ recordingId, open, onClose }: Props) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [drafted, setDrafted] = useState(false);

  const draft = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const email = await draftFollowUpEmail(recordingId);
      setSubject(email.subject);
      setBody(email.body);
      setDrafted(true);
    } catch {
      setError('Could not draft the email. Try again.');
    } finally {
      setLoading(false);
    }
  }, [recordingId]);

  // Draft once per recording, the first time the dialog opens; edits survive close and reopen.
  useEffect(() => {
    if (open && !drafted && !loading) void draft();
  }, [open, drafted, loading, draft]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to the clipboard.');
    }
  };

  const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <Dialog open={open} onClose={onClose} title="Follow-up email">
      {loading ? (
        <div role="status" className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Drafting...
        </div>
      ) : (
        <div className="space-y-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {drafted ? (
            <>
              <label className="block text-sm font-medium">
                Subject
                <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1" />
              </label>
              <label className="block text-sm font-medium">
                Body
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={copy}>
                  {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <a
                  href={mailto}
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                  Open in mail app
                </a>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={draft}>
                Try again
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
