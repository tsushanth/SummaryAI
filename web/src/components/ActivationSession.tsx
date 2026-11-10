'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { trackSignupDone } from '@/lib/activationClient';

/** In the dashboard layout: a brand-new account (email or Google) lands here, so this is where signup_done is emitted once. */
export function ActivationSession() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ACTIVATION_EVENTS !== '1') return;
    createClient().auth.getUser().then(({ data }) => {
      const u = data.user;
      if (u) void trackSignupDone(u.created_at, u.app_metadata?.provider);
    }).catch(() => {});
  }, []);
  return null;
}
