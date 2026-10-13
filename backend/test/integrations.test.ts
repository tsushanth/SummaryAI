import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/supabase.js', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('../src/config/index.js', () => ({
  config: { ENCRYPTION_KEY: '' },
}));

const guard = await import('../src/lib/ssrfGuard.js');
const svc = await import('../src/services/integrationsService.js');
const { computeMeetingAnalytics } = await import('../src/services/meetingAnalytics.js');

const payload: any = {
  event: 'recording.completed',
  recording: { id: 'r1', title: 'Sync' },
  summary: 'Short summary',
  key_points: ['kp'],
  action_items: [{ text: 'Ship it', assignee: 'Ann' }],
};

describe('ssrfGuard', () => {
  it.each([
    'http://example.com/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest',
    'https://10.1.2.3/x',
    'https://[::1]/x',
    'https://[::ffff:127.0.0.1]/x',
    'https://[fd00:ec2::254]/x',
    'https://user:pw@example.com/x',
    'https://example.com:8443/x',
    'https://foo.internal/x',
    'https://2130706433/x',
  ])('rejects %s', (u) => {
    expect(() => guard.validateOutboundUrl(u)).toThrow(guard.SsrfError);
  });

  it('accepts a public https URL', () => {
    expect(guard.validateOutboundUrl('https://hooks.example.com/a?b=1').hostname).toBe('hooks.example.com');
  });

  it('rejects when any resolved address is private (DNS rebinding)', async () => {
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    await expect(guard.resolveSafe('evil.example.com', lookup)).rejects.toThrow(guard.SsrfError);
  });

  it('revalidates every redirect hop', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const requestImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 302, headers: { location: 'https://169.254.169.254/meta' }, body: '' });
    await expect(guard.safeFetch('https://example.com/a', { lookup, requestImpl })).rejects.toThrow(guard.SsrfError);
    expect(requestImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a safe redirect', async () => {
    const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
    const requestImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 301, headers: { location: '/b' }, body: '' })
      .mockResolvedValueOnce({ status: 200, headers: {}, body: 'ok' });
    const r = await guard.safeFetch('https://example.com/a', { lookup, requestImpl });
    expect(r.status).toBe(200);
  });
});

describe('integration input validation', () => {
  it('restricts Slack to hooks.slack.com', () => {
    expect(() => svc.validateIntegrationInput('slack', { url: 'https://example.com/x' })).toThrow();
    expect(() => svc.validateIntegrationInput('slack', { url: 'https://hooks.slack.com/services/T/B/x' })).not.toThrow();
  });
  it('rejects private webhook targets', () => {
    expect(() => svc.validateIntegrationInput('webhook', { url: 'https://192.168.1.1/x' })).toThrow();
  });
  it('requires a Notion token and database id', () => {
    expect(() => svc.validateIntegrationInput('notion', { secret: 't' })).toThrow();
    expect(() =>
      svc.validateIntegrationInput('notion', { secret: 't', database_id: 'a'.repeat(32) })
    ).not.toThrow();
  });
});

describe('deliverToIntegration', () => {
  const sleep = vi.fn(async () => {});

  it('signs webhook bodies with HMAC over timestamp.body', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, body: '' }));
    const r = await svc.deliverToIntegration(
      'webhook',
      { url: 'https://hooks.example.com/in', secret: 's3cret' },
      payload,
      { fetchImpl, sleep, now: () => 1_700_000_000_000 }
    );
    expect(r.ok).toBe(true);
    const [, opts] = fetchImpl.mock.calls[0] as any;
    expect(opts.headers['X-MeetingMind-Timestamp']).toBe('1700000000');
    expect(opts.headers['X-MeetingMind-Signature']).toBe(svc.signWebhookBody('s3cret', 1_700_000_000, opts.body));
  });

  it('retries 5xx then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 503, body: '' })
      .mockResolvedValueOnce({ status: 200, body: '' });
    const r = await svc.deliverToIntegration('slack', { url: 'https://hooks.slack.com/services/a' }, payload, {
      fetchImpl,
      sleep,
    });
    expect(r).toMatchObject({ ok: true, attempts: 2 });
  });

  it('does not retry 4xx', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 400, body: '' }));
    const r = await svc.deliverToIntegration('webhook', { url: 'https://x.example.com' }, payload, { fetchImpl, sleep });
    expect(r).toMatchObject({ ok: false, attempts: 1, responseStatus: 400 });
  });

  it('gives up after max attempts on network errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const r = await svc.deliverToIntegration('webhook', { url: 'https://x.example.com' }, payload, { fetchImpl, sleep });
    expect(r).toMatchObject({ ok: false, attempts: 3, error: 'ECONNRESET' });
  });

  it('does not retry SSRF violations', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new guard.SsrfError('Address is not allowed');
    });
    const r = await svc.deliverToIntegration('webhook', { url: 'https://x.example.com' }, payload, { fetchImpl, sleep });
    expect(r).toMatchObject({ ok: false, attempts: 1 });
  });

  it('posts Notion pages with bearer token', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200, body: '' }));
    await svc.deliverToIntegration('notion', { secret: 'tok', config: { database_id: 'd'.repeat(32) } }, payload, {
      fetchImpl,
      sleep,
    });
    const [url, opts] = fetchImpl.mock.calls[0] as any;
    expect(url).toBe('https://api.notion.com/v1/pages');
    expect(opts.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(opts.body).parent.database_id).toBe('d'.repeat(32));
  });
});

describe('publicView', () => {
  it('never exposes ciphertext', () => {
    const v = svc.publicView({
      id: '1', user_id: 'u', kind: 'webhook', enabled: true,
      url_encrypted: 'CIPHER', secret_encrypted: 'CIPHER2',
      config: { display_host: 'hooks.example.com' },
      last_status: null, last_error: null, last_delivered_at: null,
    });
    expect(JSON.stringify(v)).not.toContain('CIPHER');
    expect(v.has_secret).toBe(true);
  });
});

describe('computeMeetingAnalytics', () => {
  it('computes talk share, questions and monologue', () => {
    const a = computeMeetingAnalytics(
      [
        { speaker_index: 0, text: 'Hello there. How are you?', start_time: 0, end_time: 6 },
        { speaker_index: 0, text: 'Anyway', start_time: 7, end_time: 10 },
        { speaker_index: 1, text: 'Fine', start_time: 12, end_time: 14 },
      ],
      { '1': 'Bob' }
    );
    expect(a.basis).toBe('time');
    expect(a.speakers[0]!.speaker_index).toBe(0);
    expect(a.speakers[0]!.talk_share).toBeCloseTo(0.818, 2);
    expect(a.total_questions).toBe(1);
    expect(a.longest_monologue_seconds).toBe(10);
    expect(a.speakers[1]!.name).toBe('Bob');
  });
  it('falls back to words when timestamps are unusable', () => {
    const a = computeMeetingAnalytics([{ speaker_index: 0, text: 'a b c' }, { speaker_index: 1, text: 'd' }]);
    expect(a.basis).toBe('words');
    expect(a.speakers[0]!.talk_share).toBe(0.75);
  });
  it('handles empty input', () => {
    expect(computeMeetingAnalytics(null).speakers).toEqual([]);
  });
});
