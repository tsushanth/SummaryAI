import { createServer, type Server } from 'node:http';
import { verifySignature } from '../../src/sink/httpSink.js';

export interface StoredRow {
  key: string; seq: number; botId: string | null; sessionId: string; segment_text: string; speaker_id: string; speaker_name: string;
  is_host: boolean; start_timestamp: number; end_timestamp: number; words: unknown[]; is_partial: boolean; language?: string; arrivedAt: number;
}

/**
 * Stand-in for the proposed backend route POST /internal/live-segments: verifies the HMAC, rejects stale or bad signatures,
 * inserts idempotently by `key` (the unique-index behaviour the PR asks for) and can be told to fail the next N requests.
 */
export class FakeBackend {
  rows: StoredRow[] = [];
  requests = 0;
  badSignatures = 0;
  duplicatesIgnored = 0;
  failNext = 0;
  failStatus = 503;
  private readonly seen = new Set<string>();
  private server!: Server;
  port = 0;

  constructor(private readonly secret: string) {}

  get url(): string {
    return `http://127.0.0.1:${this.port}/internal/live-segments`;
  }

  start(): Promise<void> {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        this.requests++;
        const body = Buffer.concat(chunks).toString('utf8');
        const ts = String(req.headers['x-mm-timestamp'] ?? '');
        const sig = String(req.headers['x-mm-signature'] ?? '');
        if (!verifySignature(this.secret, ts, body, sig)) { this.badSignatures++; res.writeHead(401).end(); return; }
        if (this.failNext > 0) { this.failNext--; res.writeHead(this.failStatus).end(); return; }
        const parsed = JSON.parse(body) as { botId: string | null; sessionId: string; segments: StoredRow[] };
        for (const s of parsed.segments) {
          if (this.seen.has(s.key)) { this.duplicatesIgnored++; continue; }
          this.seen.add(s.key);
          this.rows.push({ ...s, botId: parsed.botId, sessionId: parsed.sessionId, arrivedAt: Date.now() });
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      });
    });
    return new Promise((resolve) => this.server.listen(0, '127.0.0.1', () => { this.port = (this.server.address() as { port: number }).port; resolve(); }));
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }
}
