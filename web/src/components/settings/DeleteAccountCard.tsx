'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { useAuth } from '@/components/auth/AuthProvider';
import { useSubscription } from '@/hooks/useSubscription';
import { deleteAccount } from '@/lib/api/account';
import {
  DELETE_CONFIRM_WORD,
  deleteAccountThenSignOut,
  hasBillableStripeSubscription,
  isDeleteConfirmed,
} from '@/lib/accountDelete';

/** Danger zone: permanently delete the account after typing DELETE. Signs out and goes to the landing page. */
export function DeleteAccountCard() {
  const { signOut } = useAuth();
  const { provider, status } = useSubscription();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stripeWarning = hasBillableStripeSubscription({ provider, status });

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped('');
    setError(null);
  };

  const confirm = async () => {
    if (!isDeleteConfirmed(typed)) return;
    setBusy(true);
    setError(null);
    const result = await deleteAccountThenSignOut({ remove: deleteAccount, signOut });
    if (result.ok) {
      // Full navigation so no signed-in client state survives
      window.location.assign('/');
    } else {
      setBusy(false);
      setError(result.message);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>Permanently delete your account and everything in it</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Delete my account
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={close} title="Delete your account?">
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            This permanently deletes your account and your data: recordings and their audio files, transcripts,
            summaries, to-dos, calendar connections and settings. It cannot be undone, and the mobile apps will be
            signed out too.
          </p>
          {stripeWarning && (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-destructive">
              You still have a web subscription. Deleting your account does not cancel it. Cancel it first under{' '}
              <Link href="/subscription" className="underline underline-offset-2">
                Billing
              </Link>
              .
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-foreground">
              Type <strong>{DELETE_CONFIRM_WORD}</strong> to confirm
            </span>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || !isDeleteConfirmed(typed)}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Delete account
          </Button>
        </div>
      </Dialog>
    </>
  );
}
