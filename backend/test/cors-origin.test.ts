import { describe, it, expect } from 'vitest';
import express from 'express';
import cors from 'cors';
import type { AddressInfo } from 'node:net';
import { makeCorsOrigin } from '../src/lib/corsOrigin.js';

const allowed = ['https://meetingmind.org'];

describe('production CORS origin check', () => {
  const decide = (origin: string | undefined) =>
    new Promise<{ err: Error | null; allow?: boolean }>((resolve) => makeCorsOrigin(allowed)(origin, (err, allow) => resolve({ err, allow })));

  it('allows listed origins, Cloud Run URLs and requests with no origin', async () => {
    expect((await decide('https://meetingmind.org')).allow).toBe(true);
    expect((await decide('https://x-123.a.run.app')).allow).toBe(true);
    expect((await decide(undefined)).allow).toBe(true);
  });

  it('rejects an unknown origin without raising an error', async () => {
    const r = await decide('https://evil.example');
    expect(r.err).toBeNull();
    expect(r.allow).toBe(false);
  });

  it('answers a preflight from an unknown origin with a non-5xx status and no allow-origin header', async () => {
    const app = express();
    app.use(cors({ origin: makeCorsOrigin(allowed), methods: ['GET', 'POST', 'OPTIONS'] }));
    app.post('/api/recordings', (_req, res) => { res.json({ ok: true }); });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/recordings`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
      });
      expect(res.status).toBeLessThan(500);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      const ok = await fetch(`http://127.0.0.1:${port}/api/recordings`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://meetingmind.org', 'Access-Control-Request-Method': 'POST' },
      });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://meetingmind.org');
    } finally {
      server.close();
    }
  });
});
