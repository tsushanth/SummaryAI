/**
 * Web errors that are not product failures (no imports, so node loads this directly: scripts/failureNoise.test.mjs).
 *
 * 2026-11: three `unhandledrejection` reports on path "/" with 0 distinct users, "Cannot read properties of undefined (reading
 * 'getReader')" and a stack through `ext:core/01_core.js`: that is the Deno runtime, i.e. a headless crawler / link-preview
 * service executing the page's JS without the Fetch/Streams APIs a browser has. Same family as the 2026-10-30 burst of 16
 * "undefined is not an object (evaluating 'parameters.length')" from a crawler. They created harness items and alerts for a
 * defect no user can hit.
 */
const IGNORE: RegExp[] = [
  /^Script error\.?$/i,
  /ResizeObserver loop/i,
  /Failed to fetch/i,
  /Load failed/i,
  /NetworkError/i,
  /AbortError/i,
  /chrome-extension:|moz-extension:|safari-extension:/i,
  // Non-browser JS runtimes (Deno / Node-based renderers, prerender and link-preview bots).
  /\bext:core\//,
  /\bnode:internal\//,
  /deno:(?:core|runtime)\//i,
];

const BOT_UA = /HeadlessChrome|PhantomJS|Googlebot|bingbot|Bingbot|AdsBot|Lighthouse|Prerender|Slackbot|facebookexternalhit|Twitterbot|WhatsApp|Deno\/|node-fetch|undici/i;

/** text = `${message}\n${stack}`; userAgent = navigator.userAgent when known. */
export function isIgnorableWebFailure(text: string, userAgent?: string): boolean {
  return IGNORE.some((re) => re.test(text)) || (!!userAgent && BOT_UA.test(userAgent));
}
