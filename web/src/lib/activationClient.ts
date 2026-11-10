'use client';

import { apiClient } from '@/lib/api/client';
import {
  attributionProps, buildEvent, getOrCreateAnonId, isFreshSignup, parseUtm, rememberAttribution, shouldEmitOnce, trackingAllowed,
  SIGNUP_DONE_KEY, type ActivationEventName, type Props,
} from '@/lib/activation';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

function enabled(): boolean {
  if (typeof window === 'undefined' || !API_URL) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return trackingAllowed({ flag: process.env.NEXT_PUBLIC_ACTIVATION_EVENTS, doNotTrack: nav.doNotTrack, gpc: nav.globalPrivacyControl });
}

const local = (): Storage | null => { try { return window.localStorage; } catch { return null; } };
const session = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };

/** Fire-and-forget. Silent unless the build flag is on and the browser has not opted out. Never throws, never blocks. */
export function track(name: ActivationEventName, props: Props = {}): void {
  try {
    if (!enabled()) return;
    const ev = buildEvent(name, getOrCreateAnonId(local()), props);
    fetch(`${API_URL}/api/activation/events`, {
      method: 'POST', keepalive: true, credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev),
    }).catch(() => {});
  } catch { /* analytics must never break the page */ }
}

/** Capture utm / referrer once per tab session (first touch wins). */
export function captureAttribution() {
  return rememberAttribution(session(), parseUtm(window.location.search, document.referrer, window.location.hostname, window.location.pathname));
}

/** landed: once per tab session per page, with the utm / referrer as props. */
export function trackLanded(page: 'landing' | 'auth'): void {
  if (!enabled()) return;
  const attr = captureAttribution();
  if (!shouldEmitOnce(session(), `mm_act_landed_${page}`)) return;
  track('landed', { page, ...attributionProps(attr) });
}

/** signup_done: for an account created in the last 15 minutes, once per browser; also stores the attribution server-side. */
export async function trackSignupDone(createdAt: string | undefined, provider?: string): Promise<void> {
  try {
    if (!enabled() || !isFreshSignup(createdAt)) return;
    if (!shouldEmitOnce(local(), SIGNUP_DONE_KEY)) return;
    const attr = captureAttribution();
    track('signup_done', { provider: provider && /^[a-z0-9_-]{1,20}$/i.test(provider) ? provider : 'unknown', ...attributionProps(attr) });
    await apiClient('/api/activation/attribution', {
      method: 'POST',
      body: JSON.stringify({ anon_id: getOrCreateAnonId(local()), ...attr, platform: 'web' }),
    });
  } catch { /* best effort */ }
}
