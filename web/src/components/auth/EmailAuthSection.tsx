'use client';

import { useSearchParams } from 'next/navigation';
import { EmailAuthForm } from './EmailAuthForm';

/** Reads ?returnTo= (same as the Google button) and renders the email form. */
export function EmailAuthSection() {
  const returnTo = useSearchParams().get('returnTo');
  return <EmailAuthForm returnTo={returnTo} />;
}
