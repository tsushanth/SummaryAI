/** The free trial's own limits and the spend rules around it (migration 034). */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pgAvailable, startTestDb, type TestDb } from './helpers-pg.js';

const MIGRATIONS = [
  'migrations/007_phone_calls.sql', 'migrations/022_phone_calls_updated_at.sql', 'migrations/027_activation_events.sql',
  'migrations/032_phone_calls_repair.sql', 'migrations/033_phone_numbers_agents.sql', 'migrations/034_phone_agent_trial.sql',
  'migrations/034_phone_agent_trial.sql',
];
const CAP = 25_000_000;
let db: TestDb;
const run = pgAvailable ? describe : describe.skip;

run('phone free trial (SQL)', () => {
  beforeAll(() => { db = startTestDb(MIGRATIONS); }, 60_000);
  afterAll(() => db?.stop());
  beforeEach(() => db.sql('truncate phone_ledger, phone_halts, phone_numbers, phone_subscriptions, phone_trials, activation_events cascade'));

  const q = (s: string) => db.sql(s);
  const json = (s: string) => JSON.parse(q(`select ${s}`));
  /** For functions that answer with a boolean. */
  const yes = (s: string) => q(`select ${s}`) === 't';
  const spent = () => Number(q('select phone_month_spent(phone_month())'));
  const start = (user: string, hash = `h${user}`, dry = false) => json(`phone_trial_start('${user}', '${hash}', ${dry})`);
  const state = (user: string) => json(`phone_trial_state('${user}')`);
  let n = 0;
  const number = (user: string, status = 'active') => {
    const id = randomUUID();
    q(`insert into phone_numbers (id, phone_number, country, kind, user_id, status) values ('${id}', '+1512555${String(++n).padStart(4, '0')}', 'US', 'personal', '${user}', '${status}')`);
    return id;
  };
  const agentLeg = (user: string, company = true) => {
    const call = randomUUID();
    return { call, ...json(`phone_reserve_leg('agent', '${call}', '${user}', null, null, 'r', '+15125550100', '+14155550100', 'CA${call}', ${company})`) };
  };
  const settle = (call: string, seconds: number) => json(`phone_settle_leg('${call}', ${seconds})`);

  it('has at most five trials open, and at most five started in a month', () => {
    const users = Array.from({ length: 5 }, () => randomUUID());
    for (const u of users) expect(start(u)).toMatchObject({ ok: true });
    expect(start(randomUUID())).toMatchObject({ ok: false, reason: 'trial_full' });
    expect(yes(`phone_trial_end('${users[0]}', 'ended_by_user')`)).toBe(true);
    expect(yes(`phone_trial_end('${users[0]}', 'ended_by_user')`)).toBe(false);
    expect(start(randomUUID())).toMatchObject({ ok: false, reason: 'trial_full' }); // five already started this month
    q("update phone_trials set started_at = started_at - interval '40 days'");
    expect(start(randomUUID())).toMatchObject({ ok: true }); // a place is free and the month is new
    expect(start(randomUUID())).toMatchObject({ ok: false, reason: 'trial_full' }); // five are open again
  });

  it('is had once per account and once per phone number', () => {
    const u = randomUUID();
    expect(start(u, 'same', true)).toMatchObject({ ok: true });
    expect(q('select count(*) from phone_trials')).toBe('0');
    expect(start(u, 'same')).toMatchObject({ ok: true });
    expect(start(u, 'same')).toMatchObject({ ok: true, already: true });
    expect(start(randomUUID(), 'same')).toMatchObject({ ok: false, reason: 'trial_used' });
    yes(`phone_trial_end('${u}', 'ended_by_user')`);
    expect(start(u, 'other')).toMatchObject({ ok: false, reason: 'trial_used' });
    q(`update phone_trials set user_id = null where user_id = '${u}'`); // account deleted
    expect(start(randomUUID(), 'same')).toMatchObject({ ok: false, reason: 'trial_used' });
  });

  it('holds at most five own numbers, paid ones included, and needs room in the cap', () => {
    for (let i = 0; i < 5; i++) number(randomUUID());
    expect(start(randomUUID())).toMatchObject({ ok: false, reason: 'trial_full' });
    q('truncate phone_numbers cascade');
    q(`insert into phone_ledger (kind, month, reserved_micro, actual_micro, state) values ('call', phone_month(), 0, ${CAP - 1_000_000}, 'settled')`);
    expect(start(randomUUID())).toMatchObject({ ok: false, reason: 'budget_used' });
    q('truncate phone_ledger; insert into phone_halts (month, reason) values (phone_month(), \'x\')');
    expect(start(randomUUID())).toMatchObject({ ok: false, reason: 'budget_used' });
  });

  it('a purchase that failed cancels the trial; one that holds a number does not', () => {
    const u = randomUUID();
    start(u);
    const id = number(u, 'buying');
    expect(yes(`phone_trial_cancel('${u}')`)).toBe(false);
    q(`update phone_numbers set status = 'released' where id = '${id}'`);
    expect(yes(`phone_trial_cancel('${u}')`)).toBe(true);
    expect(start(u)).toMatchObject({ ok: true });
  });

  it('gives fifteen agent minutes in total, in started minutes, from company money', () => {
    const u = randomUUID();
    expect(agentLeg(u)).toMatchObject({ ok: false, reason: 'no_trial' });
    start(u);
    expect(state(u)).toMatchObject({ running: true, seconds_left: 900, open_call: false });
    const a = agentLeg(u);
    expect(a).toMatchObject({ ok: true, limit_seconds: 600, funding: 'company' });
    expect(state(u)).toMatchObject({ seconds_left: 300, open_call: true });
    expect(spent()).toBe(10 * 150_000 + 30_000);
    settle(a.call, 541); // ten started minutes
    const b = agentLeg(u);
    expect(b).toMatchObject({ ok: true, limit_seconds: 300 });
    settle(b.call, 241);
    expect(state(u)).toMatchObject({ seconds_left: 0, open_call: false });
    expect(agentLeg(u)).toMatchObject({ ok: false, reason: 'user_minutes_used' });
    q("update phone_ledger set month = month - interval '1 month'"); // the allowance is per trial, not per month
    expect(agentLeg(u)).toMatchObject({ ok: false, reason: 'user_minutes_used' });
  });

  it('gives nothing after the trial ends, and never goes over the company cap', () => {
    const u = randomUUID();
    start(u);
    q("update phone_trials set ends_at = now() - interval '1 second'");
    expect(state(u)).toMatchObject({ running: false });
    expect(agentLeg(u)).toMatchObject({ ok: false, reason: 'no_trial' });
    expect(json(`phone_reserve_draft('${u}')`)).toMatchObject({ ok: false, reason: 'no_trial' });
    q("update phone_trials set ends_at = now() + interval '1 day'");
    q(`insert into phone_ledger (kind, month, reserved_micro, actual_micro, state) values ('call', phone_month(), 0, ${CAP - 500_000}, 'settled')`);
    const a = agentLeg(u);
    expect(a).toMatchObject({ ok: true, limit_seconds: 180 });
    expect(spent()).toBeLessThanOrEqual(CAP);
  });

  it('allows a few agent changes per trial; a refused one is given back', () => {
    const u = randomUUID();
    expect(json(`phone_reserve_draft('${u}')`)).toMatchObject({ ok: false, reason: 'no_trial' });
    start(u);
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = json(`phone_reserve_draft('${u}')`);
      expect(r.ok).toBe(true);
      ids.push(r.ledger_id);
      q("update phone_ledger set created_at = created_at - interval '5 hours'; update phone_trials set started_at = started_at - interval '5 hours'");
    }
    expect(json(`phone_reserve_draft('${u}')`)).toMatchObject({ ok: false, reason: 'user_limit' });
    q(`select phone_release_draft(${ids[0]})`);
    expect(json(`phone_reserve_draft('${u}')`).ok).toBe(true);
  });

  it('leaves subscribers as they were', () => {
    const u = randomUUID();
    q(`insert into phone_subscriptions (user_id, product_id, token_hash, purchase_token, state, period_start, expires_at, call_seconds, agent_seconds)
       values ('${u}', 'p', 't', 't', 'SUBSCRIPTION_STATE_ACTIVE', now() - interval '1 day', now() + interval '9 days', 6000, 1800)`);
    expect(json(`phone_reserve_draft('${u}')`).ok).toBe(true);
    expect(agentLeg(u, false)).toMatchObject({ ok: true, funding: 'subscription' });
  });

  it('ends trials that hold no number', () => {
    const [kept, expired, abandoned, fresh] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const u of [kept, expired, abandoned, fresh]) start(u);
    number(kept);
    q(`update phone_trials set ends_at = now() - interval '1 minute' where user_id in ('${kept}', '${expired}')`);
    q(`update phone_trials set started_at = now() - interval '2 hours' where user_id = '${abandoned}'`);
    expect(Number(q('select phone_trial_sweep(false)'))).toBe(2);
    expect(state(expired).end_reason).toBe('expired');
    expect(state(abandoned).end_reason).toBe('no_number');
    expect(state(kept).ended_at).toBeNull();
    expect(Number(q('select phone_trial_sweep(true)'))).toBe(1);
    expect(state(fresh).end_reason).toBe('switched_off');
    const gone = randomUUID();
    start(gone);
    q(`update phone_trials set user_id = null where user_id = '${gone}'`); // account deleted
    expect(Number(q('select phone_trial_sweep(false)'))).toBe(1);
  });

  it('counts steps without test accounts', () => {
    const [a, t] = [randomUUID(), randomUUID()];
    const event = (user: string, props: string) => q(`insert into activation_events (anon_id, user_id, name, platform, props) values ('server-phone-events', '${user}', 'phone_step', 'server', '${props}')`);
    event(a, '{"step":"trial_refused","reason":"trial_full"}');
    event(a, '{"step":"trial_refused","reason":"trial_full"}');
    event(t, '{"step":"trial_started","test":true}');
    expect(q("select step, reason, users, events from phone_step_counts(now() - interval '1 day')")).toBe('trial_refused|trial_full|1|2');
  });

  it('app clients reach none of it', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const s of ['select * from phone_trials', "select phone_trial_start(gen_random_uuid(), 'h', false)", "select phone_trial_end(gen_random_uuid(), 'x')",
        'select phone_release_draft(1)', 'select * from phone_step_counts(now())']) {
        expect(() => q(`set role ${role}; ${s}`), `${role}: ${s}`).toThrow(/permission denied/);
      }
    }
  });

  it('can be undone and applied again', () => {
    const file = (p: string) => readFileSync(join(__dirname, '..', 'supabase', p), 'utf8');
    q(file('rollbacks/034_phone_agent_trial_down.sql'));
    q(file('migrations/033_phone_numbers_agents.sql'));
    expect(q("select to_regclass('public.phone_trials') is null")).toBe('t');
    q(file('migrations/034_phone_agent_trial.sql'));
    expect(start(randomUUID())).toMatchObject({ ok: true });
  });
});
