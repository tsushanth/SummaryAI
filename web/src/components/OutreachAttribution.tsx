'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { apiClient } from '@/lib/api/client';
import { captureOutreachTouch, sendOutreachAttribution } from '@/lib/outreach';

/** Do Not Track / Global Privacy Control: keep and send nothing. */
function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === '1' || nav.doNotTrack === 'yes' || nav.globalPrivacyControl === true;
}

/** Mounted once in the root layout. Renders nothing. Keeps the outreach campaign params of the landing URL (first touch only). */
export function OutreachCapture() {
  useEffect(() => {
    if (!optedOut()) captureOutreachTouch(window.location.search);
  }, []);
  return null;
}

let attempted = false;

/**
 * Mounted once in the signed-in dashboard layout. If a stored outreach first touch exists and the account is new, posts
 * { utm_source, utm_campaign, utm_content, platform } once to POST /api/activation/attribution and forgets it. One attempt per page load;
 * a failed post keeps the touch for the next load. Independent of the activation funnel flag. Renders nothing.
 */
export function OutreachAttributionSender() {
  useEffect(() => {
    if (attempted || optedOut()) return;
    attempted = true;
    createClient().auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) { attempted = false; return; }
      return sendOutreachAttribution(
        (body) => apiClient('/api/activation/attribution', { method: 'POST', body: JSON.stringify(body) }),
        u.created_at,
      );
    }).catch(() => {});
  }, []);
  return null;
}
