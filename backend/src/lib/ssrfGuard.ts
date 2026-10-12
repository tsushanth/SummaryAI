/**
 * SSRF guard for user-supplied outbound URLs (webhooks, Slack, Notion).
 *
 * - https only, no credentials in the URL, port 443 or an explicit allow-list
 * - blocks private / loopback / link-local / CGNAT / metadata / multicast / reserved ranges
 *   for both IPv4 and IPv6 (including IPv4-mapped IPv6)
 * - resolves DNS and validates EVERY resolved address; the connection is made with a
 *   custom `lookup` that re-validates, so a DNS-rebinding answer cannot slip past
 * - redirects are followed manually (max 3), each hop re-validated
 */

import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local + cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

/** Expand an IPv6 address into 8 16-bit groups. Returns null if unparseable. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.split('%')[0]!; // strip zone id
  // embedded IPv4 tail (::ffff:1.2.3.4)
  const v4Tail = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    if (!net.isIPv4(v4Tail[2]!)) return null;
    const n = ipv4ToInt(v4Tail[2]!);
    addr = `${v4Tail[1]}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out = groups.map((g) => parseInt(g, 16));
  return out.some((x) => Number.isNaN(x) || x < 0 || x > 0xffff) ? null : out;
}

function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return true; // fail closed
  const [a, b, c, d, e, f, g6, h] = g as [number, number, number, number, number, number, number, number];
  // :: and ::1
  if (g.slice(0, 7).every((x) => x === 0) && (h === 0 || h === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d  -> judge the embedded v4
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0)) {
    return isBlockedIPv4(`${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`);
  }
  // 64:ff9b::/96 NAT64 -> embedded v4
  if (a === 0x64 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return isBlockedIPv4(`${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`);
  }
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local (incl. fd00:ec2::254 AWS)
  if ((a & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((a & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x2002) return true; // 6to4: may embed private v4
  if (a === 0x2001 && b === 0) return true; // Teredo
  return false;
}

/** True if the literal IP address is in a blocked range (or unparseable). */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true;
}

export interface ValidatedUrl {
  url: URL;
  /** hostname with IPv6 brackets stripped */
  hostname: string;
}

/**
 * Static (no DNS) validation of a URL. Throws SsrfError.
 */
export function validateOutboundUrl(raw: string): ValidatedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new SsrfError('Only https URLs are allowed');
  if (url.username || url.password) throw new SsrfError('Credentials in URL are not allowed');
  if (url.port && url.port !== '443') throw new SsrfError('Only the default https port is allowed');

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!hostname) throw new SsrfError('Missing host');
  if (BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw new SsrfError('Host is not allowed');
  }
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SsrfError('Address is not allowed');
  } else if (/^[0-9.]+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    // WHATWG URL normalises most numeric forms, but never trust an all-numeric hostname
    throw new SsrfError('Address is not allowed');
  }
  return { url, hostname };
}

export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Validate and resolve. Every resolved address must be public.
 * Returns the list of safe addresses.
 */
export async function resolveSafe(
  hostname: string,
  lookup: LookupFn = defaultLookup
): Promise<Array<{ address: string; family: number }>> {
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new SsrfError('Address is not allowed');
    return [{ address: hostname, family: net.isIPv6(hostname) ? 6 : 4 }];
  }
  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(hostname);
  } catch {
    throw new SsrfError('Host could not be resolved');
  }
  if (!addrs.length) throw new SsrfError('Host could not be resolved');
  for (const a of addrs) {
    if (isBlockedIp(a.address)) throw new SsrfError('Host resolves to a disallowed address');
  }
  return addrs;
}

/** Full pre-flight check: static validation + DNS. */
export async function assertSafeUrl(raw: string, lookup: LookupFn = defaultLookup): Promise<URL> {
  const { url, hostname } = validateOutboundUrl(raw);
  await resolveSafe(hostname, lookup);
  return url;
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  /** test seam */
  lookup?: LookupFn;
  /** test seam: replaces the actual network request (receives already-validated target) */
  requestImpl?: (u: URL, opts: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number; addresses: Array<{ address: string; family: number }>; maxResponseBytes: number }) => Promise<SafeResponse>;
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function realRequest(
  u: URL,
  opts: { method: string; headers: Record<string, string>; body?: string; timeoutMs: number; addresses: Array<{ address: string; family: number }>; maxResponseBytes: number }
): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    // Pin the connection to the addresses we validated. The lookup callback is
    // invoked by https for the TCP connect, so there is no second DNS query.
    const lookup = ((_host: string, options: any, cb: any) => {
      const callback = typeof options === 'function' ? options : cb;
      const wantAll = typeof options === 'object' && options?.all;
      if (wantAll) callback(null, opts.addresses);
      else callback(null, opts.addresses[0]!.address, opts.addresses[0]!.family);
    }) as any;

    const req = https.request(
      {
        protocol: 'https:',
        hostname: u.hostname.replace(/^\[|\]$/g, ''),
        servername: net.isIP(u.hostname.replace(/^\[|\]$/g, '')) ? undefined : u.hostname,
        port: 443,
        path: `${u.pathname}${u.search}`,
        method: opts.method,
        headers: {
          ...opts.headers,
          ...(opts.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(opts.body)) } : {}),
        },
        lookup,
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > opts.maxResponseBytes) {
            // keep what we have; we only need a snippet for logs
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as any,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        res.on('end', done);
        res.on('close', done);
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/**
 * fetch-like helper that enforces the SSRF policy on the initial URL and every redirect hop.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024;
  const request = options.requestImpl ?? realRequest;
  let method = options.method ?? 'POST';
  let body = options.body;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const { url, hostname } = validateOutboundUrl(current);
    const addresses = await resolveSafe(hostname, options.lookup);
    const res = await request(url, {
      method,
      headers: options.headers ?? {},
      body,
      timeoutMs,
      addresses,
      maxResponseBytes,
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers['location'];
      const location = Array.isArray(loc) ? loc[0] : loc;
      if (!location) return res;
      // Resolve relative redirects, then loop: the next iteration re-validates (https-only, IP, DNS).
      current = new URL(location, url).toString();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      continue;
    }
    return res;
  }
  throw new SsrfError('Too many redirects');
}
