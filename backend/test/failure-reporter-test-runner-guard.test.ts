import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Regression: the reporter has a built-in production URL and key and used to disable itself only for
// NODE_ENV=test/development or FAILURE_REPORTER_DISABLED=1, so a stray report call in a test run (with NODE_ENV
// unset or overridden) posted a fake error to the live reporter Worker and emailed the owner.
describe('failure reporter under the test runner', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FAILURE_REPORTER_DISABLED', '');
    vi.stubEnv('FAILURE_REPORTER_FORCE', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('never posts to the production endpoint', async () => {
    expect(process.env.VITEST).toBeTruthy(); // sanity: running under vitest
    const calls: unknown[][] = [];
    vi.stubGlobal('fetch', async (...a: unknown[]) => { calls.push(a); return new Response('{}', { status: 202 }); });
    const fr = await import('../src/lib/failureReporter.js');
    fr.reportFailure('x', new Error('must not leave the process'));
    fr.reportBackendError({ method: 'GET', path: '/x' }, new Error('must not leave the process'), 500);
    await fr.reportCrash('x', new Error('must not leave the process'));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });
});
