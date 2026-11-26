'use client';

import { useSearchParams } from 'next/navigation';
import { authCallbackError } from '@/lib/emailAuth';

/** The sign-in callback sends failures back as /auth?error=...; before this the page showed nothing at all. */
export function AuthErrorNotice() {
  const message = authCallbackError(useSearchParams().get('error'));
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </p>
  );
}
