import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('failure reporter user reference', () => {
  let bodies: any[];
  beforeEach(() => {
    bodies = [];
    vi.resetModules();
    vi.stubGlobal('fetch', async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return new Response('{}', { status: 202 }); });
    // The reporter is disabled when NODE_ENV is test/development; load it as production would.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FAILURE_REPORTER_DISABLED', '0');
  });

  it('attaches the signed-in user id (never an email) to a backend error', async () => {
    const { reportBackendError } = await import('../src/lib/failureReporter.js');
    reportBackendError({ method: 'GET', path: '/api/recordings', user: { id: 'd33955a8-5bf1-4744-83da-65f1c0e1aa11' } }, new Error('boom'), 500);
    await new Promise((r) => setTimeout(r, 20));
    expect(bodies).toHaveLength(1);
    expect(bodies[0].user).toEqual({ ref: 'd33955a8-5bf1-4744-83da-65f1c0e1aa11' });
    expect(JSON.stringify(bodies[0].user)).not.toContain('@');
  });

  it('sends no user when the request failed before authentication', async () => {
    const { reportBackendError } = await import('../src/lib/failureReporter.js');
    reportBackendError({ method: 'GET', path: '/api/recordings' }, new Error('boom'), 500);
    await new Promise((r) => setTimeout(r, 20));
    expect(bodies[0].user).toBeUndefined();
  });

  it('ignores client errors (4xx)', async () => {
    const { reportBackendError } = await import('../src/lib/failureReporter.js');
    reportBackendError({ method: 'GET', path: '/x', user: { id: 'd33955a8-5bf1-4744-83da' } }, new Error('nope'), 404);
    await new Promise((r) => setTimeout(r, 20));
    expect(bodies).toHaveLength(0);
  });
});
