import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const queues: Record<string, any[]> = {};
const queue = (t: string, ...r: any[]) => (queues[t] ||= []).push(...r);
function builder(table: string) {
  const q: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          const result = (queues[table] || []).shift() ?? { data: null, error: null };
          return (res: any, rej: any) => Promise.resolve(result).then(res, rej);
        }
        return () => q;
      },
    }
  );
  return q;
}

const mockConfig = vi.hoisted(() => ({ ENCRYPTION_KEY: 'aa'.repeat(32) }));

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn((t: string) => builder(t)) } }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1' };
    next();
  },
}));
vi.mock('../src/config/index.js', () => ({ config: mockConfig }));

const { default: router } = await import('../src/routes/integrations.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { encryptToken } = await import('../src/services/encryptionService.js');

async function put(kind: string, body: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations', router);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/integrations/${kind}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

function storedRow() {
  return {
    id: 'i1',
    user_id: 'user-1',
    kind: 'webhook',
    enabled: true,
    url_encrypted: encryptToken('https://hooks.example.com/a'),
    secret_encrypted: encryptToken('old-secret'),
    config: { display_host: 'hooks.example.com' },
    last_status: null,
    last_error: null,
    last_delivered_at: null,
  };
}

beforeEach(() => {
  for (const k of Object.keys(queues)) delete queues[k];
  mockConfig.ENCRYPTION_KEY = 'aa'.repeat(32);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ENCRYPTION_KEY changed after an integration was saved', () => {
  it('returns a clear 409 JSON error (no crash) when a kept secret cannot be decrypted', async () => {
    const row = storedRow();
    mockConfig.ENCRYPTION_KEY = 'bb'.repeat(32);
    queue('user_integrations', { data: [row], error: null });
    const res = await put('webhook', { enabled: false });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Re-enter/);
    expect(JSON.stringify(res.body)).not.toContain('old-secret');
  });

  it('also 409s when only the URL is re-entered but the old signing secret is unreadable', async () => {
    const row = storedRow();
    mockConfig.ENCRYPTION_KEY = 'bb'.repeat(32);
    queue('user_integrations', { data: [row], error: null });
    const res = await put('webhook', { url: 'https://hooks.example.com/b' });
    expect(res.status).toBe(409);
  });

  it('lets the user overwrite by re-entering url and secret', async () => {
    const row = storedRow();
    mockConfig.ENCRYPTION_KEY = 'bb'.repeat(32);
    queue('user_integrations', { data: [row], error: null }, { data: row, error: null });
    const res = await put('webhook', { url: 'https://hooks.example.com/b', secret: 'new-secret' });
    expect(res.status).toBe(200);
    expect(res.body.integration.kind).toBe('webhook');
    expect(JSON.stringify(res.body)).not.toContain('new-secret');
  });
});
