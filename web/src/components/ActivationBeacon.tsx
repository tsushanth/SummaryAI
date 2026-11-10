'use client';

import { useEffect } from 'react';
import { trackLanded } from '@/lib/activationClient';

/** Emits the `landed` activation event once per tab session. Renders nothing; does nothing unless the build flag is on. */
export function ActivationBeacon({ page }: { page: 'landing' | 'auth' }) {
  useEffect(() => { trackLanded(page); }, [page]);
  return null;
}
