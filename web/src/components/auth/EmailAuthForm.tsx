'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { friendlyAuthError, isValidEmail, passwordProblem, resetRedirectUrl } from '@/lib/emailAuth';

type Mode = 'signin' | 'signup' | 'forgot';

/** Email + password sign-in, sign-up and password reset, for accounts created with email (e.g. on Android). */
export function EmailAuthForm({ returnTo }: { returnTo?: string | null }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (mode === 'signup') {
      const problem = passwordProblem(password);
      if (problem) return setError(problem);
    } else if (mode === 'signin' && !password) {
      return setError('Enter your password.');
    }

    setBusy(true);
    const supabase = createClient();
    try {
      if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: resetRedirectUrl(window.location.origin),
        });
        if (err) throw err;
        setNotice('If an account exists for that email, a reset link is on its way.');
      } else if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (err) throw err;
        if (data.session) {
          window.location.assign(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/recordings');
        } else {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('signin');
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (err) throw err;
        window.location.assign(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/recordings');
      }
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link';

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <label className="block text-sm font-medium">
        Email
        <Input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1"
          disabled={busy}
        />
      </label>
      {mode !== 'forgot' && (
        <label className="block text-sm font-medium">
          Password
          <Input
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1"
            disabled={busy}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {title}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
        {mode === 'signin' ? (
          <>
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => switchMode('signup')}>
              Create an account
            </button>
            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
          </>
        ) : (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => switchMode('signin')}>
            Back to sign in
          </button>
        )}
      </div>
    </form>
  );
}
