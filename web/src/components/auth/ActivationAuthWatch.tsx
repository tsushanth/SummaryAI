'use client';

import { useRef } from 'react';
import { track } from '@/lib/activationClient';

/** Wraps the auth form + Google button: emits signup_started once per page load on first focus or click inside. */
export function ActivationAuthWatch({ children }: { children: React.ReactNode }) {
  const sent = useRef(false);
  const fire = () => { if (!sent.current) { sent.current = true; track('signup_started'); } };
  return <div className="space-y-4" onFocusCapture={fire} onClickCapture={fire}>{children}</div>;
}
