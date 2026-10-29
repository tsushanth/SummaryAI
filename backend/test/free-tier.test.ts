import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

// ---- fake supabase: records which tables are read, serves configurable rows ----------------
const state = {
  recordingCount: 0,
  profileStatus: 'free' as string | null,
  subscriptionRow: null as null | { status: string },
  tablesRead: [] as string[],
  inserts: 0,
};

function chain(table: string) {
  const q: any = {};
  for (const m of ['select', 'eq', 'in', 'limit', 'order']) q[m] = vi.fn(() => q);
  q.single = () => {
    if (table === 'profiles') return Promise.resolve({ data: { subscription_status: state.profileStatus }, error: null });
    if (table === 'recordings') return Promise.resolve({ data: { id: 'rec-1', user_id: 'u' }, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  q.maybeSingle = () => Promise.resolve({ data: table === 'subscriptions' ? state.subscriptionRow : null, error: null });
  q.insert = vi.fn(() => {
    state.inserts += 1;
    return q;
  });
  q.delete = vi.fn(() => q);
  q.then = (res: any, rej: any) => Promise.resolve({ count: state.recordingCount, data: [], error: null }).then(res, rej);
  return q;
}

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((t: string) => {
      state.tablesRead.push(t);
      return chain(t);
    }),
    storage: {
      from: () => ({ createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://upload.test/x' }, error: null }) }),
    },
  },
}));

let currentUser = 'user-1';
vi.mock('../src/middleware/auth.js', () => ({
  optionalAuth: (req: any, _res: any, next: any) => ((req.user = { id: currentUser }), next()),
  authenticate: (req: any, _res: any, next: any) => ((req.user = { id: currentUser }), next()),
}));
vi.mock('../src/services/processingService.js', () => ({ triggerProcessing: vi.fn() }));
vi.mock('../src/routes/questions.js', async () => ({ default: (await import('express')).Router() }));

const cfg: Record<string, any> = {
  MAX_RECORDING_DURATION_SECONDS: 14400,
  MAX_AUDIO_FILE_SIZE_MB: 500,
  UPLOAD_URL_EXPIRY_SECONDS: 3600,
  STORAGE_BUCKET_AUDIO: 'recordings-audio',
  FREE_TIER_LEGACY_LIMITS: false,
};
vi.mock('../src/config/index.js', () => ({ config: cfg }));

const { default: router } = await import('../src/routes/recordings.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const freeTier = await import('../src/services/freeTier.js');

async function createRecording(headers: Record<string, string> = {}, body: any = { title: 'Weekly sync', file_size_bytes: 1_000_000, duration_seconds: 600 }) {
  const app = express();
  app.use(express.json());
  app.use('/api/recordings', router);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/recordings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  state.recordingCount = 0;
  state.profileStatus = 'free';
  state.subscriptionRow = null;
  state.tablesRead = [];
  state.inserts = 0;
  cfg.FREE_TIER_LEGACY_LIMITS = false;
  currentUser = `user-${Math.random()}`; // fresh rate-limit bucket per test
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('free tier constants', () => {
  it('keeps the old limit value and a generous per-user create cap', () => {
    expect(freeTier.FREE_TIER_RECORDING_LIMIT).toBe(3);
    expect(freeTier.CREATE_RECORDING_MAX_PER_WINDOW).toBe(60);
    expect(freeTier.CREATE_RECORDING_WINDOW_MS).toBe(3_600_000);
  });

  it('the legacy switch is off by default', () => {
    expect(freeTier.legacyFreeLimitsEnabled()).toBe(false);
  });
});

describe('planFeatures', () => {
  it('free user: recording, summaries and exports are free; Q&A, bot, phone, calendar stay paid', () => {
    expect(freeTier.planFeatures(false, false)).toEqual({
      unlimitedRecordings: true,
      aiSummaries: true,
      qaChat: false,
      meetingBot: false,
      phoneRecording: false,
      calendarSync: false,
      exportPdf: true,
    });
  });

  it('subscriber gets everything', () => {
    expect(Object.values(freeTier.planFeatures(true, false)).every(Boolean)).toBe(true);
  });

  it('legacy mode restores the old matrix: free user gets nothing', () => {
    expect(Object.values(freeTier.planFeatures(false, true)).some(Boolean)).toBe(false);
    expect(Object.values(freeTier.planFeatures(true, true)).every(Boolean)).toBe(true);
  });

  it('uses the config flag when the second argument is omitted', () => {
    cfg.FREE_TIER_LEGACY_LIMITS = true;
    expect(freeTier.planFeatures(false).aiSummaries).toBe(false);
    cfg.FREE_TIER_LEGACY_LIMITS = false;
    expect(freeTier.planFeatures(false).aiSummaries).toBe(true);
  });
});

describe('POST /api/recordings (no recording limit)', () => {
  it.each([3, 4, 9, 10, 500])('a free user who already has %i recordings can create another', async (existing) => {
    state.recordingCount = existing;
    const r = await createRecording();
    expect(r.status).toBe(201);
    expect(r.body.upload.url).toBe('https://upload.test/x');
  });

  it('does not read profiles, subscriptions or count recordings while the legacy limit is off', async () => {
    state.recordingCount = 10;
    await createRecording();
    expect(state.tablesRead).not.toContain('profiles');
    expect(state.tablesRead).not.toContain('subscriptions');
    expect(state.tablesRead.filter((t) => t === 'recordings')).toHaveLength(1); // only the insert
  });

  it('still enforces the per-file size limit', async () => {
    const r = await createRecording({}, { title: 'big', file_size_bytes: 600 * 1024 * 1024 });
    expect(r.status).toBe(400);
  });

  it('still enforces the duration limit', async () => {
    const r = await createRecording({}, { title: 'long', file_size_bytes: 1000, duration_seconds: 14401 });
    expect(r.status).toBe(400);
  });

  it('rate limits creation per user: request 61 within the window gets 429, another user is unaffected', async () => {
    const first = currentUser;
    // one app/server per request in createRecording is fine: the limiter lives in the router module
    for (let i = 0; i < freeTier.CREATE_RECORDING_MAX_PER_WINDOW; i++) {
      expect((await createRecording()).status).toBe(201);
    }
    const blocked = await createRecording();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    currentUser = `${first}-other`;
    expect((await createRecording()).status).toBe(201);
  });
});

describe('POST /api/recordings with the legacy limit switched back on', () => {
  beforeEach(() => {
    cfg.FREE_TIER_LEGACY_LIMITS = true;
  });

  it('blocks a free user at 3 recordings with 403 SUBSCRIPTION_REQUIRED', async () => {
    state.recordingCount = 3;
    const r = await createRecording();
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('allows a free user under the limit', async () => {
    state.recordingCount = 2;
    expect((await createRecording()).status).toBe(201);
  });

  it('lets an active subscriber (profile) past the limit', async () => {
    state.recordingCount = 50;
    state.profileStatus = 'active';
    expect((await createRecording()).status).toBe(201);
  });

  it('lets a Play subscriber (subscriptions table) and a client-header subscriber past the limit', async () => {
    state.recordingCount = 50;
    state.subscriptionRow = { status: 'active' };
    expect((await createRecording()).status).toBe(201);
    state.subscriptionRow = null;
    expect((await createRecording({ 'x-subscription-active': 'true' })).status).toBe(201);
  });
});

describe('paid features are not gated by the backend (documented, unchanged)', () => {
  it('there is no server-side subscription gate besides the legacy recording limit', async () => {
    // Guard: Q&A, cross-meeting chat, bot and phone routes do not check subscription state on the server (they are
    // gated in the clients). recordings.ts only returns the legacy-limit error; the check itself lives in freeTier.ts.
    // If someone adds a server-side gate later, this test fails so the change is deliberate.
    const { readdirSync, readFileSync } = await import('node:fs');
    const routesDir = new URL('../src/routes/', import.meta.url);
    const offenders = readdirSync(routesDir)
      .filter((f) => f.endsWith('.ts') && !['subscriptions.ts', 'webhooks.ts', 'coaching.ts', 'recordings.ts'].includes(f))
      .filter((f) => /SUBSCRIPTION_REQUIRED|subscription_status/.test(readFileSync(new URL(f, routesDir), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
