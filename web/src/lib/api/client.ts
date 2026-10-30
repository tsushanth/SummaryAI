import { createClient } from '@/lib/supabase/client';
import { reportWebFailure } from '@/components/WebFailureReporter';

const API_URL = process.env.NEXT_PUBLIC_API_URL!;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();

  // First try getSession (fast, from memory/storage)
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return session.access_token;
  }

  // If no session, try getUser which validates with server and may restore session
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    // Session should be available now after getUser
    const { data: { session: refreshedSession } } = await supabase.auth.getSession();
    return refreshedSession?.access_token || null;
  }

  return null;
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && {
        Authorization: `Bearer ${accessToken}`,
      }),
      ...options.headers,
    },
  });

  if (!response.ok) {
    // 5xx seen from the browser also covers a gateway/proxy answering for a dead backend (502/503/504), which the
    // backend's own reporter never sees. Path only: ids and the query string are dropped.
    if (response.status >= 500) {
      const path = endpoint.split('?')[0].replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id').replace(/\/\d{3,}(?=\/|$)/g, '/:id');
      reportWebFailure('api_5xx', new Error(`API request failed with status ${response.status}`), { endpoint: path, status: String(response.status) });
    }
    const error = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      error.error?.message || `Request failed with status ${response.status}`
    );
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text);
}
