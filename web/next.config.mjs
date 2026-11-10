/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async redirects() {
    // The old Stripe checkout return URL; MeetingMind is free now and there is no checkout.
    return [{ source: "/subscription/success", destination: "/recordings", permanent: false }];
  },
  async headers() {
    // Public share pages: never cached, indexed, or leaked via Referer (the token is in the URL).
    return [
      {
        // Baseline hardening for every page. Listed first so the more specific rules below can override a key.
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: "object-src 'none'; base-uri 'self'; frame-ancestors 'self'" },
        ],
      },
      {
        source: '/share/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
      {
        // Landing-page screenshots: replaced by publishing new files, so a day of caching is plenty.
        source: '/landing/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'mlofjzlmncgnhxbiuemf.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
};

export default nextConfig;
