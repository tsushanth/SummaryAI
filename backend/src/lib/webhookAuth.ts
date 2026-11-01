import { timingSafeEqual } from 'node:crypto';

/**
 * RevenueCat sends the configured Authorization header verbatim. Fails CLOSED: when no expected value is configured the
 * request is rejected, because this webhook writes subscription state and an unauthenticated one would let anyone grant
 * a plan to any user id. (It used to accept everything when REVENUECAT_WEBHOOK_AUTH_HEADER was unset, which is how
 * production has been running; MeetingMind no longer uses RevenueCat, iOS uses StoreKit 2 and Android uses Play billing.)
 */
export function isRevenueCatAuthorized(received: string | undefined, expected: string | undefined): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
