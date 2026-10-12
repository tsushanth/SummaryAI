import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

interface CookieToSet {
  name: string;
  value: string;
  options: CookieOptions;
}

export async function middleware(request: NextRequest) {
  // Public share pages never need a session: skip the Supabase round trip (and its failure modes) entirely.
  if (request.nextUrl.pathname.startsWith('/share/')) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // NOTE: /share/[token] is intentionally public and must NOT be added to the list below.
  // Protected routes - redirect to auth if not logged in
  if (
    !user &&
    (request.nextUrl.pathname.startsWith('/recordings') ||
      request.nextUrl.pathname.startsWith('/search') ||
      request.nextUrl.pathname.startsWith('/chat') ||
      request.nextUrl.pathname.startsWith('/meetings') ||
      request.nextUrl.pathname.startsWith('/todos') ||
      request.nextUrl.pathname.startsWith('/phone') ||
      request.nextUrl.pathname.startsWith('/settings'))
  ) {
    return NextResponse.redirect(new URL('/auth', request.url));
  }

  // Redirect logged-in users away from auth page
  if (user && request.nextUrl.pathname === '/auth') {
    return NextResponse.redirect(new URL('/recordings', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
