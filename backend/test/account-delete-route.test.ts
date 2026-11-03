import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const purge = vi.fn();
let authUser: { id: string } | undefined = { id: '11111111-1111-4111-8111-111111111111' };

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: {} }));
vi.mock('../src/middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = authUser; next(); },
}));
vi.mock('../src/services/accountPurge.js', () => ({ runAccountPurge: (...a: unknown[]) => purge(...a) }));
vi.mock('../src/services/accountPurgeAdapters.js', () => ({ createPurgeDeps: () => ({ marker: 'deps' }) }));

const { default: router } = await import('../src/routes/users.js');

async function del(path = '/api/users/account', init: RequestInit = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/users', router);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'DELETE', ...init });
    return { status: res.status, body: await res.json() };
  } finally { server.close(); }
}

const base = { counts: {}, pending: { storage: 0, recall: 0, twilio: 0 } };
beforeEach(() => { purge.mockReset(); authUser = { id: '11111111-1111-4111-8111-111111111111' }; });

describe('DELETE /api/users/account', () => {
  it('complete -> 200 success (unchanged for existing clients)', async () => {
    purge.mockResolvedValue({ status: 'complete', ...base });
    const r = await del();
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.purge.status).toBe('complete');
  });
  it('pending_external -> 202 success with purge status', async () => {
    purge.mockResolvedValue({ status: 'pending_external', counts: {}, pending: { storage: 0, recall: 2, twilio: 0 } });
    const r = await del();
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ success: true, purge: { status: 'pending_external', pending: { recall: 2 } } });
  });
  it('in_progress -> 202', async () => {
    purge.mockResolvedValue({ status: 'in_progress', ...base });
    expect((await del()).status).toBe(202);
  });
  it('dry_run -> 200 with plan, flagged as dry_run', async () => {
    purge.mockResolvedValue({ status: 'dry_run', ...base, plan: { storage_objects: 3, recall_bots: 1, twilio_recordings: 0, rows: {} } });
    const r = await del();
    expect(r.status).toBe(200);
    expect(r.body.purge).toMatchObject({ status: 'dry_run', plan: { storage_objects: 3 } });
  });
  it('blocked -> 503 and the account is reported as not deleted', async () => {
    purge.mockResolvedValue({ status: 'blocked', ...base });
    const r = await del();
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('EXTERNAL_DELETE_FAILED');
  });
  it('failed -> 500 DELETE_FAILED; thrown error -> 500 SERVER_ERROR without leaking the message', async () => {
    purge.mockResolvedValue({ status: 'failed', ...base });
    expect((await del()).body.error.code).toBe('DELETE_FAILED');
    purge.mockRejectedValue(new Error('secret internal detail'));
    const r = await del();
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret internal detail');
  });
  it('unauthenticated -> 401 and nothing runs', async () => {
    authUser = undefined;
    const r = await del();
    expect(r.status).toBe(401);
    expect(purge).not.toHaveBeenCalled();
  });
  it('only ever purges the authenticated user, ignoring any id in the query or body', async () => {
    purge.mockResolvedValue({ status: 'complete', ...base });
    await del('/api/users/account?userId=22222222-2222-4222-8222-222222222222', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: '22222222-2222-4222-8222-222222222222' }) });
    expect(purge).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', { marker: 'deps' });
  });
});
