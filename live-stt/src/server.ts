import { createHash } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AlertHook } from './alerts.js';
import { parseIngestUrl, verifyIngestToken } from './auth.js';
import { parseControlBody, verifyControl } from './control.js';
import { languageHints } from './languages.js';
import { StreamLimiter } from './concurrency.js';
import { SlidingWindowLimiter } from './rateLimit.js';
import { parseRecallMessage } from './recall/protocol.js';
import { MeetingSession, type SessionConfig } from './session.js';
import type { SegmentSink } from './sink/types.js';
import type { SttEngine } from './stt/types.js';

export interface ServerDeps {
  ingestSecrets: string[];
  /** Secrets accepted for POST /control/language (backend -> service). Empty / unset = the route answers 404. */
  controlSecrets?: string[];
  /** Control requests per IP per minute (default 600). */
  maxControlPerMin?: number;
  engine: SttEngine;
  fallbackEngine?: SttEngine | undefined;
  sink: SegmentSink;
  session?: Partial<SessionConfig>;
  /** Cap on Soniox streams opened by this service (shared key!). */
  maxStreams: number;
  maxSessions: number;
  adminToken?: string | undefined;
  alert?: AlertHook;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
  trustFlyProxy?: boolean;
  recallGraceMs?: number;
  /** Upgrade attempts per IP per minute, and failed-auth attempts per IP per minute before the IP is blocked. */
  maxUpgradesPerMin?: number;
  maxAuthFailuresPerMin?: number;
}

interface Entry {
  session: MeetingSession;
  socket: WebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  closing: boolean;
}

const MAX_PAYLOAD = 256 * 1024;
const MAX_CONTROL_BODY = 2048;
/** Language changes for a meeting whose audio has not connected yet are kept this long / this many at most. */
const PENDING_LANG_TTL_MS = 60 * 60_000;
const PENDING_LANG_MAX = 500;
const PING_MS = 25_000;

function refTag(ref: string): string {
  return createHash('sha256').update(ref).digest('hex').slice(0, 10);
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export class IngestServer {
  readonly http: Server;
  readonly wss: WebSocketServer;
  readonly limiter: StreamLimiter;
  readonly sessions = new Map<string, Entry>();
  /** Final metrics of the most recent meetings (bounded), for /healthz?detail=1 and post-mortems. */
  readonly closedMetrics: (Record<string, unknown> & { id: string })[] = [];
  private readonly attempts: SlidingWindowLimiter;
  private readonly controlAttempts: SlidingWindowLimiter;
  private readonly pendingLang = new Map<string, { language: string; at: number }>();
  private readonly failures: SlidingWindowLimiter;
  private readonly startedAt = Date.now();
  private unhandled = 0;

  constructor(private readonly d: ServerDeps) {
    this.limiter = new StreamLimiter(d.maxStreams);
    this.attempts = new SlidingWindowLimiter({ max: d.maxUpgradesPerMin ?? 60, windowMs: 60_000 });
    this.failures = new SlidingWindowLimiter({ max: d.maxAuthFailuresPerMin ?? 8, windowMs: 60_000 });
    this.controlAttempts = new SlidingWindowLimiter({ max: d.maxControlPerMin ?? 600, windowMs: 60_000 });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
    this.http = createHttpServer((req, res) => this.onHttp(req, res));
    this.http.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket as Duplex, head));
  }

  noteUnhandled(): void {
    this.unhandled++;
  }

  /** Queued language changes (tests / diagnostics). */
  pendingLanguageCount(): number {
    return this.pendingLang.size;
  }

  private queueLanguage(ref: string, language: string): void {
    const t = Date.now();
    this.pendingLang.delete(ref);
    if (this.pendingLang.size >= PENDING_LANG_MAX) {
      for (const [k, v] of this.pendingLang) if (t - v.at > PENDING_LANG_TTL_MS) this.pendingLang.delete(k);
      // still full: drop the oldest (Map iterates in insertion order)
      while (this.pendingLang.size >= PENDING_LANG_MAX) this.pendingLang.delete(this.pendingLang.keys().next().value as string);
    }
    this.pendingLang.set(ref, { language, at: t });
  }

  private takePendingLanguage(ref: string): string | null {
    const v = this.pendingLang.get(ref);
    if (!v) return null;
    this.pendingLang.delete(ref);
    return Date.now() - v.at <= PENDING_LANG_TTL_MS ? v.language : null;
  }

  /** POST /control/language: see ../../backend/LIVE_STT.md. 200 applied, 202 queued, 400, 401, 404 (disabled), 413, 429. */
  private onControl(req: IncomingMessage, res: import('node:http').ServerResponse): void {
    const send = (status: number, body: Record<string, unknown> = {}) => {
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    const secrets = this.d.controlSecrets ?? [];
    if (secrets.length === 0) { send(404); return; }
    const ip = this.clientIp(req);
    if (this.failures.isLimited(ip) || !this.controlAttempts.hit(ip)) { send(429); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_CONTROL_BODY) { tooBig = true; return; }
      chunks.push(c);
    });
    req.on('error', () => send(400));
    req.on('end', () => {
      try {
        if (tooBig) { send(413); return; }
        const raw = Buffer.concat(chunks).toString('utf8');
        const h = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
        if (!verifyControl({ secrets, timestampSec: h('x-mm-timestamp'), signature: h('x-mm-signature'), rawBody: raw, nowSec: Math.floor(Date.now() / 1000) })) {
          this.failures.hit(ip);
          send(401);
          return;
        }
        const body = parseControlBody(raw);
        if (!body) { send(400); return; }
        const entry = this.sessions.get(body.ref);
        if (!entry || entry.closing) {
          this.queueLanguage(body.ref, body.language);
          this.d.log?.('language queued', { id: refTag(body.ref), language: body.language });
          send(202, { applied: false, queued: true });
          return;
        }
        const changed = entry.session.setLanguageHints(languageHints(body.language));
        this.d.log?.('language set', { id: refTag(body.ref), language: body.language, changed });
        send(200, { applied: true, changed });
      } catch {
        send(500);
      }
    });
  }

  listen(port: number, host = '0.0.0.0'): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, host, () => {
        const a = this.http.address();
        resolve(typeof a === 'object' && a ? a.port : port);
      });
    });
  }

  async stop(): Promise<void> {
    this.http.close();
    for (const e of this.sessions.values()) {
      if (e.graceTimer) clearTimeout(e.graceTimer);
      if (e.pingTimer) clearInterval(e.pingTimer);
      e.socket?.terminate();
    }
    await Promise.allSettled([...this.sessions.values()].map((e) => e.session.close()));
    this.sessions.clear();
    this.wss.close();
  }

  private clientIp(req: IncomingMessage): string {
    if (this.d.trustFlyProxy) {
      const h = req.headers['fly-client-ip'];
      if (typeof h === 'string' && h) return h;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  // ------------------------------------------------------------------ http

  private onHttp(req: IncomingMessage, res: import('node:http').ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      const detail = url.searchParams.get('detail') === '1';
      const body: Record<string, unknown> = {
        ok: true,
        uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
        sessions: this.sessions.size,
        streams: { inUse: this.limiter.inUse(), cap: this.limiter.capacity() },
        rssMb: Math.round(process.memoryUsage().rss / 1048576),
        unhandledRejections: this.unhandled,
      };
      if (detail) {
        const ok = !!this.d.adminToken && req.headers.authorization === `Bearer ${this.d.adminToken}`;
        if (!ok) { res.writeHead(401).end(); return; }
        body.recentlyClosed = this.closedMetrics;
        body.meetings = [...this.sessions.entries()].map(([ref, e]) => ({ id: refTag(ref), ...e.session.metrics.snapshot(), debug: e.session.debug() }));
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/control/language') { this.onControl(req, res); return; }
    res.writeHead(404).end();
  }

  // ------------------------------------------------------------------ websocket

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', () => { /* client vanished mid-handshake */ });
    const ip = this.clientIp(req);
    if (this.failures.isLimited(ip) || !this.attempts.hit(ip)) { reject(socket, 429, 'Too Many Requests'); return; }
    const parsed = parseIngestUrl(req.url ?? '');
    if (!parsed) { this.failures.hit(ip); reject(socket, 404, 'Not Found'); return; }
    if (!verifyIngestToken(this.d.ingestSecrets, parsed.ref, parsed.token)) { this.failures.hit(ip); reject(socket, 401, 'Unauthorized'); return; }

    let entry = this.sessions.get(parsed.ref);
    if (entry?.closing) { reject(socket, 503, 'Service Unavailable'); return; }
    if (!entry) {
      if (this.sessions.size >= this.d.maxSessions) {
        this.d.alert?.('mm_stream_cap', { sessions: this.sessions.size, cap: this.d.maxSessions, during: 'upgrade' });
        reject(socket, 503, 'Service Unavailable');
        return;
      }
      // Language for the first connection: a change queued before the audio arrived > the URL's lang > the service default.
      const queued = this.takePendingLanguage(parsed.ref);
      const hints = queued !== null ? languageHints(queued) : parsed.lang ? [parsed.lang] : (this.d.session?.languageHints ?? []);
      const session = new MeetingSession({
        ref: parsed.ref, engine: this.d.engine, fallbackEngine: this.d.fallbackEngine, sink: this.d.sink,
        config: { ...this.d.session, languageHints: hints }, limiter: this.limiter, alert: this.d.alert, log: this.d.log,
      });
      entry = { session, socket: null, graceTimer: null, pingTimer: null, closing: false };
      this.sessions.set(parsed.ref, entry);
      this.d.log?.('session opened', { id: refTag(parsed.ref) });
    }
    const e = entry;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(parsed.ref, e, ws));
  }

  private attach(ref: string, e: Entry, ws: WebSocket): void {
    if (e.graceTimer) { clearTimeout(e.graceTimer); e.graceTimer = null; }
    if (e.pingTimer) clearInterval(e.pingTimer);
    const old = e.socket;
    e.socket = ws;
    if (old && old !== ws) { try { old.close(1000, 'replaced'); } catch { /* */ } }
    e.pingTimer = setInterval(() => { try { ws.ping(); } catch { /* */ } }, PING_MS);
    let pinnedBot: string | null = e.session.botId;

    ws.on('message', (data, isBinary) => {
      try {
        if (isBinary) { e.session.metrics.add('invalidMessages'); return; }
        const m = parseRecallMessage(data.toString());
        if (m.kind === 'invalid') { e.session.metrics.add('invalidMessages'); return; }
        if (m.kind === 'ignored') return;
        if (m.botId) {
          if (pinnedBot === null) { pinnedBot = m.botId; e.session.setBotId(m.botId); }
          else if (pinnedBot !== m.botId) { e.session.metrics.add('invalidMessages'); return; }
        }
        if (m.kind === 'audio') e.session.handleAudio({ relMs: m.relMs, durMs: m.durMs, pcm: m.pcm });
        else if (m.kind === 'speech') e.session.handleSpeech({ on: m.on, participant: m.participant, relMs: m.relMs });
        // 'empty': a silent-but-unmuted participant. Nothing to send; the next chunk's timestamp re-anchors the stream clock.
      } catch (err) {
        this.d.log?.('message handler error', { err: (err as Error).name });
      }
    });
    ws.on('error', () => { /* followed by close */ });
    ws.on('close', () => {
      if (e.socket !== ws) return; // replaced by a newer socket
      if (e.pingTimer) { clearInterval(e.pingTimer); e.pingTimer = null; }
      e.socket = null;
      e.graceTimer = setTimeout(() => {
        e.closing = true;
        void e.session.close().catch(() => undefined).finally(() => {
          this.sessions.delete(ref);
          this.closedMetrics.unshift({ id: refTag(ref), ...e.session.metrics.snapshot() });
          this.closedMetrics.length = Math.min(this.closedMetrics.length, 50);
          this.d.log?.('session closed', { id: refTag(ref) });
        });
      }, this.d.recallGraceMs ?? 120_000);
    });
  }
}
