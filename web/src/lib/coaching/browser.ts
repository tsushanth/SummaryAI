/** The one AI Coach store of this tab. Browser only: call from effects and event handlers, never while rendering on the server. */
import { reportWebFailure } from '@/components/WebFailureReporter';
import { getAccessToken } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { createCoachingApi } from './api';
import { createCoachSession, type CoachSession } from './session';

export const coachingApi = createCoachingApi({
  baseUrl: process.env.NEXT_PUBLIC_API_URL!,
  getToken: getAccessToken,
  onServerError: (endpoint, status) =>
    reportWebFailure('api_5xx', new Error(`API request failed with status ${status}`), { endpoint, status: String(status) }),
});

let session: CoachSession | undefined;

export function coachSession(): CoachSession {
  if (session) return session;
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    /* blocked: unacknowledged stops are not kept across a reload */
  }
  const created = createCoachSession(coachingApi, {
    storage,
    onFailure: (flow, status) => {
      if (navigator.onLine === false) return;
      reportWebFailure(flow, new Error(`AI Coach failed with status ${status}`), { status: String(status) });
    },
  });
  // Signing out, or in as someone else, forgets the sessions of the account that left.
  let userId: string | undefined;
  createClient().auth.onAuthStateChange((event, auth) => {
    const next = auth?.user?.id;
    if (event === 'SIGNED_OUT' || (userId && next && next !== userId)) created.reset();
    userId = next;
  });
  session = created;
  return created;
}
