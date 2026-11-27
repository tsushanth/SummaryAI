/** Usage counts include only people who could see phone calls, by country (migration 035). */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgAvailable, startTestDb, type TestDb } from './helpers-pg.js';

const MIGRATIONS = [
  'migrations/007_phone_calls.sql', 'migrations/022_phone_calls_updated_at.sql', 'migrations/027_activation_events.sql',
  'migrations/032_phone_calls_repair.sql', 'migrations/033_phone_numbers_agents.sql', 'migrations/034_phone_agent_trial.sql',
  'migrations/035_phone_audience_counts.sql', 'migrations/035_phone_audience_counts.sql',
];
let db: TestDb;
const run = pgAvailable ? describe : describe.skip;

run('phone usage counts (SQL)', () => {
  beforeAll(() => { db = startTestDb(MIGRATIONS); }, 60_000);
  afterAll(() => db?.stop());
  beforeEach(() => db.sql('truncate activation_events'));

  const q = (s: string) => db.sql(s);
  const add = (user: string, props: Record<string, unknown>, daysAgo = 0) =>
    q(`insert into activation_events (anon_id, user_id, name, platform, props, created_at) values ('server-phone-events', '${user}', 'phone_step', 'server', '${JSON.stringify(props)}', now() - interval '${daysAgo} days')`);
  const seen = (user: string, country: string, daysAgo = 0, extra: Record<string, unknown> = {}) => add(user, { step: 'feature_seen', country, via: 'country', ...extra }, daysAgo);
  const steps = () => q("select step, country, reason, users, events from phone_step_counts(now() - interval '30 days') order by 1, 2, 3");
  const funnel = () => q("select segment, country, could_see, tab_opened, connected from phone_funnel(now() - interval '30 days')");

  it('leaves out anyone who was never shown the feature', () => {
    const hidden = randomUUID();
    add(hidden, { step: 'number_removed' });
    add(hidden, { step: 'tab_opened', country: 'US' });
    expect(steps()).toBe('');
    expect(funnel()).toBe('');
  });

  it('splits by the country the person was last shown it under', () => {
    const [us, ca, moved] = [randomUUID(), randomUUID(), randomUUID()];
    seen(us, 'US'); add(us, { step: 'tab_opened', country: 'US' }); add(us, { step: 'call_connected' });
    seen(ca, 'CA'); add(ca, { step: 'business_answer', answer: 'business' });
    seen(moved, 'US', 3); seen(moved, 'CA', 1); add(moved, { step: 'verify_ok', country: 'US' }, 2);
    expect(steps().split('\n').sort()).toEqual([
      'business_answer|CA||1|1', 'call_connected|US||1|1', 'feature_seen|CA|country|2|3', 'feature_seen|US|country|1|1',
      'tab_opened|US||1|1', 'verify_ok|CA||1|1',
    ]);
    expect(funnel().split('\n')).toEqual(['business|CA|1|0|0', 'not_asked|CA|1|0|0', 'not_asked|US|1|1|1']);
  });

  it('counts somebody shown it before the window, and leaves test accounts and test devices out', () => {
    const [old, tester] = [randomUUID(), randomUUID()];
    seen(old, 'US', 90); add(old, { step: 'call_ended' });
    seen(tester, 'US', 0, { test: true }); add(tester, { step: 'call_connected' });
    expect(steps()).toBe('call_ended|US||1|1');
    expect(funnel()).toBe('not_asked|US|1|0|0');
  });

  it('counts the free-minutes card and its button like any step', () => {
    const u = randomUUID();
    seen(u, 'US'); add(u, { step: 'more_minutes_shown', country: 'US' }); add(u, { step: 'more_minutes_interest', country: 'US' });
    expect(steps().split('\n')).toEqual(['feature_seen|US|country|1|1', 'more_minutes_interest|US||1|1', 'more_minutes_shown|US||1|1']);
  });

  it('app clients reach none of it', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const s of ['select * from phone_audience()', 'select * from phone_step_counts(now())', 'select * from phone_funnel(now())']) {
        expect(() => q(`set role ${role}; ${s}`), `${role}: ${s}`).toThrow(/permission denied/);
      }
    }
    expect(q('set role service_role; select count(*) from phone_audience()')).toBe('0');
  });

  it('can be undone and applied again', () => {
    const file = (p: string) => readFileSync(join(__dirname, '..', 'supabase', p), 'utf8');
    q(file('rollbacks/035_phone_audience_counts_down.sql'));
    expect(q("select count(*) from pg_proc where proname = 'phone_audience'")).toBe('0');
    q(`insert into activation_events (anon_id, user_id, name, platform, props) values ('server-phone-events', '${randomUUID()}', 'phone_step', 'server', '{"step":"tab_opened"}')`);
    expect(q("select step, reason, users, events from phone_step_counts(now() - interval '1 day')")).toBe('tab_opened||1|1');
    expect(() => q('set role anon; select * from phone_funnel(now())')).toThrow(/permission denied/);
    q(file('migrations/035_phone_audience_counts.sql'));
    expect(steps()).toBe('');
  });
});
