type OriginCallback = (err: Error | null, allow?: boolean) => void;

/**
 * Origin check for the production CORS config. An origin that is not allowed is rejected quietly (no CORS headers, so
 * the browser blocks it) instead of passing an Error to the callback: an Error becomes a 500 on the preflight and is
 * reported as a backend failure, which turned every stray origin (a dev box, a preview deploy, a scanner) into an alert.
 */
export function makeCorsOrigin(allowedOrigins: string[]) {
  return (origin: string | undefined, callback: OriginCallback): void => {
    // Requests with no origin (mobile apps, curl, server to server) are always allowed.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Cloud Run URLs
    if (origin.endsWith('.run.app')) return callback(null, true);
    return callback(null, false);
  };
}
