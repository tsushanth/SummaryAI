'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RibbonMark } from '@/components/ui/ribbon-mark';
import { createClient } from '@/lib/supabase/client';
import { friendlyAuthError, passwordProblem } from '@/lib/emailAuth';

/** Landing page of the password-reset email: the callback has already signed the user in with the recovery code. */
export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().auth.updateUser({ password });
    if (err) {
      setError(friendlyAuthError(err.message));
      setBusy(false);
      return;
    }
    window.location.assign('/recordings');
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-lg border border-border bg-card p-6 sm:p-8" noValidate>
        <RibbonMark className="h-10 w-10" />
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">Choose a new password</h1>
        <label className="block text-sm font-medium">
          New password
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Save password
        </Button>
        <p className="text-sm text-muted-foreground">
          Link expired?{' '}
          <Link href="/auth" className="underline underline-offset-2 hover:text-foreground">
            Request a new one
          </Link>
        </p>
      </form>
    </main>
  );
}
