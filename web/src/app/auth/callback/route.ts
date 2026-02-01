import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  // Get the actual origin from headers (handles proxied requests like Cloud Run)
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost:3000';
  const protocol = headersList.get('x-forwarded-proto') || 'https';
  const origin = `${protocol}://${host}`;

  console.log('[Auth Callback] Received request:', {
    hasCode: !!code,
    hasError: !!error,
    error,
    origin,
    host,
    protocol,
  });

  if (error) {
    console.log('[Auth Callback] Error from OAuth:', error);
    return NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent(error)}`);
  }

  if (code) {
    console.log('[Auth Callback] Exchanging code for session...');
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            console.log('[Auth Callback] Setting cookies:', cookiesToSet.map(c => c.name));
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      console.error('[Auth Callback] Error exchanging code:', exchangeError);
      return NextResponse.redirect(`${origin}/auth?error=${encodeURIComponent(exchangeError.message)}`);
    }

    console.log('[Auth Callback] Session created successfully:', {
      userId: data.session?.user?.id,
      email: data.session?.user?.email,
    });

    // Check for returnTo cookie (set by GoogleSignIn component)
    const returnToCookie = cookieStore.get('authReturnTo');
    let redirectUrl = `${origin}/recordings`; // Default redirect

    if (returnToCookie?.value) {
      const returnTo = decodeURIComponent(returnToCookie.value);
      // Validate that returnTo is a relative path (security: prevent open redirect)
      if (returnTo.startsWith('/') && !returnTo.startsWith('//')) {
        redirectUrl = `${origin}${returnTo}`;
        console.log('[Auth Callback] Redirecting to returnTo:', returnTo);
      }
      // Clear the cookie
      cookieStore.delete('authReturnTo');
    }

    return NextResponse.redirect(redirectUrl);
  }

  console.log('[Auth Callback] No code provided, redirecting to auth');
  return NextResponse.redirect(`${origin}/auth`);
}
