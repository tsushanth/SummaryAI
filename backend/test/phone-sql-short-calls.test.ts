/** Very short calls use no free minutes, the first five of a month (migration 038), on the migrations as production has them. */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pgAvailable, startTestDb, type TestDb } from './helpers-pg.js';

const BEFORE = [
  'migrations/007_phone_calls.sql', 'migrations/022_phone_calls_updated_at.sql', 'migrations/027_activation_events.sql',
  'migrations/032_phone_calls_repair.sql', 'migrations/033_phone_numbers_agents.sql', 'migrations/034_phone_agent_trial.sql',
  'migrations/035_phone_audience_counts.sql', 'migrations/036_phone_trial_three.sql', 'migrations/037_phone_minutes_shown.sql',
];
const UP = 'migrations/038_phone_free_short_calls.sql';
const DOWN = 'rollbacks/038_phone_free_short_calls_down.sql';
const file = (p: string) => readFileSync(join(__dirname, '..', 'supabase', p), 'utf8');
let db: TestDb;
const run = pgAvailable ? describe : describe.skip;

run('free short calls (SQL, migration 038)', () => {
  beforeAll(() => { db = startTestDb([...BEFORE, UP, UP]); }, 60_000);
  afterAll(() => db?.stop());
  beforeEach(() => db.sql('truncate phone_ledger, phone_halts, phone_numbers cascade'));

  const q = (s: string) => db.sql(s);
  const json = (s: string) => JSON.parse(q(`select ${s}`));
  let seq = 0;
  /** Moves every row out of the rate-limit windows while keeping it in this month's money and minutes. */
  const forgetRates = () => q("update phone_ledger set created_at = created_at - interval '40 days' where created_at > now() - interval '1 day'");
  const reserve = (user: string, from = `h${user}`) => {
    const call = randomUUID();
    return { call, ...json(`phone_reserve_call('${call}', '${user}', '${from}', 'd${++seq}', '+15125550100', '+14155550101')`) };
  };
  const claim = (call: string, user: string) => json(`phone_claim_call('${call}', '${user}', 'CA${call}')`);
  /** One whole outgoing call with this much talk time. */
  const talk = (user: string, seconds: number, from = `h${user}`) => {
    forgetRates();
    const r = reserve(user, from);
    expect(r).toMatchObject({ ok: true });
    claim(r.call, user);
    return { call: r.call, ...json(`phone_settle_call('${r.call}', ${seconds + 20}, ${seconds})`) };
  };
  const used = (user: string, from: string | null = `h${user}`) =>
    Number(q(`select phone_minutes_used('${user}', ${from === null ? 'null' : `'${from}'`}, phone_month())`));
  const left = (user: string, from = `h${user}`) => json(`phone_budget('${user}', '${from}')`).minutes_left as number;
  const spent = () => Number(q('select phone_month_spent(phone_month())'));

  it('the two numbers are limits like the others', () => {
    const l = json('phone_limits()');
    expect([l.free_short_under_seconds, l.free_short_calls, l.user_minutes, l.cap_micro]).toEqual([15, 5, 30, 25_000_000]);
  });

  it.each([[1, 0], [14, 0], [15, 1], [16, 1], [60, 1], [61, 2]])('a call with %i seconds of talk uses %i free minutes', (seconds, minutes) => {
    const u = randomUUID();
    talk(u, seconds);
    expect(used(u)).toBe(minutes);
    expect(left(u)).toBe(30 - minutes);
  });

  it('only the first five short calls of the month are free; later ones count in started minutes', () => {
    const u = randomUUID();
    for (let i = 0; i < 5; i++) talk(u, 10);
    expect([used(u), left(u)]).toEqual([0, 30]);
    talk(u, 10);
    expect([used(u), left(u)]).toEqual([1, 29]);
    talk(u, 1);
    expect([used(u), left(u)]).toEqual([2, 28]);
  });

  it('an unanswered call uses nothing and is not one of the five; neither is a longer call or one never connected', () => {
    const u = randomUUID();
    for (let i = 0; i < 6; i++) talk(u, 0);
    talk(u, 15);
    forgetRates();
    const dropped = reserve(u);
    expect(q(`select phone_release_call('${dropped.call}', '${u}')`)).toBe('t');
    expect(used(u)).toBe(1);
    for (let i = 0; i < 5; i++) talk(u, 14);
    expect(used(u)).toBe(1);
    talk(u, 14);
    expect(used(u)).toBe(2);
    talk(u, 0);
    expect(used(u)).toBe(2);
  });

  it('a call the carrier could not be asked about keeps its whole reservation and is not one of the five', () => {
    const u = randomUUID();
    const r = reserve(u); claim(r.call, u);
    q(`select phone_settle_call('${r.call}', 0, 0, true)`);
    expect([used(u), left(u)]).toEqual([30, 0]);
    expect(q(`select count(*) from phone_free_short_calls('${u}', null, phone_month())`)).toBe('0');
  });

  it('books the same money against the company cap for a free call', () => {
    const u = randomUUID();
    const costs = Array.from({ length: 6 }, () => talk(u, 10).cost_micro as number);
    // one carrier minute with recording and transcription, one app minute, one summary
    expect(costs).toEqual(Array(6).fill(28_000 + 5_000 + 30_000));
    expect(spent()).toBe(6 * 63_000);
  });

  it('decides what a new call may use', () => {
    const u = randomUUID();
    talk(u, 29 * 60);
    for (let i = 0; i < 5; i++) talk(u, 14);
    forgetRates();
    const next = reserve(u);
    expect(next).toMatchObject({ ok: true, limit_seconds: 60, minutes_left: 1 });
    q(`select phone_release_call('${next.call}', '${u}')`);
    talk(u, 14); // the sixth
    forgetRates();
    expect(reserve(u)).toMatchObject({ ok: false, reason: 'user_minutes_used' });
    expect(left(u)).toBe(0);
  });

  it('a call in progress counts as before until it is known to be short', () => {
    const u = randomUUID();
    const r = reserve(u); claim(r.call, u);
    q(`update phone_ledger set claimed_at = now() - interval '10 seconds' where call_id = '${r.call}'`);
    expect([used(u), left(u)]).toEqual([30, 29]);
    q(`select phone_settle_call('${r.call}', 30, 10)`);
    expect([used(u), left(u)]).toEqual([0, 30]);
  });

  it('five per own number across accounts, in the same scope the used minutes are counted', () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    for (let i = 0; i < 3; i++) talk(a, 10, 'same');
    for (let i = 0; i < 2; i++) talk(b, 10, 'same');
    expect([used(a, 'same'), used(b, 'same'), used(c, 'same')]).toEqual([0, 0, 0]);
    talk(b, 10, 'same'); // the sixth with this number, only the third of this account
    expect([used(a, 'same'), used(b, 'same'), used(c, 'same')]).toEqual([1, 1, 1]);
    expect([left(a, 'same'), left(c, 'same')]).toEqual([29, 29]);
    // Without the shared number each account is under five.
    expect([used(a, null), used(b, null), used(c, null), used(b, 'another')]).toEqual([0, 0, 0, 0]);
  });

  it('five per account across its numbers', () => {
    const u = randomUUID();
    for (let i = 0; i < 3; i++) talk(u, 10, 'one');
    for (let i = 0; i < 3; i++) talk(u, 10, 'two');
    expect([used(u, 'one'), used(u, 'two'), used(u, null)]).toEqual([1, 1, 1]);
    expect(used(randomUUID(), 'one')).toBe(0); // somebody who only shares the first number sees its three
  });

  it('the five are the first ones started, and start again each month', () => {
    const u = randomUUID();
    const calls = Array.from({ length: 6 }, () => talk(u, 10).call);
    const free = q(`select call_id from phone_ledger where id in (select phone_free_short_calls('${u}', null, phone_month())) order by id`).split('\n');
    expect(free).toEqual(calls.slice(0, 5));
    q("update phone_ledger set month = (phone_month() - interval '1 month')::date");
    expect(Number(q(`select phone_minutes_used('${u}', null, (phone_month() - interval '1 month')::date)`))).toBe(1);
    for (let i = 0; i < 5; i++) talk(u, 10);
    expect(used(u)).toBe(0);
  });

  it('calls paid by a subscription are not among the five', () => {
    const u = randomUUID();
    q(`insert into phone_ledger (kind, funding, user_id, month, reserved_micro, actual_micro, actual_seconds, state)
       select 'call', 'subscription', '${u}', phone_month(), 0, 0, 10, 'settled' from generate_series(1, 6)`);
    for (let i = 0; i < 5; i++) talk(u, 10);
    expect(used(u)).toBe(0);
  });

  it('a forwarded incoming call counts as before, is shown, and is not one of the five', () => {
    const u = randomUUID();
    const call = randomUUID();
    expect(json(`phone_reserve_leg('inbound', '${call}', '${u}', null, 'h${u}', 'r', '+15125550100', '+14155550101', 'CAin', true)`)).toMatchObject({ ok: true });
    q(`select phone_settle_leg('${call}', 10)`);
    expect([used(u), left(u)]).toEqual([1, 29]);
    for (let i = 0; i < 5; i++) talk(u, 10);
    expect([used(u), left(u)]).toEqual([1, 29]);
  });

  it('is the server\'s alone', () => {
    const u = randomUUID();
    for (const role of ['anon', 'authenticated']) {
      for (const s of [
        'select phone_limits()', `select * from phone_free_short_calls('${u}', null, phone_month())`,
        `select phone_minutes_used('${u}', null, phone_month())`, `select phone_minutes_shown('${u}', null, phone_month())`,
        `select phone_budget('${u}', null)`,
      ]) {
        expect(() => q(`set role ${role}; ${s}`), `${role}: ${s}`).toThrow(/permission denied/);
      }
    }
    talk(u, 10);
    expect(q(`set role service_role; select phone_budget('${u}', null)->>'minutes_left'`)).toBe('30');
    const reserved = q(`set role service_role; select phone_reserve_call('${randomUUID()}', '${u}', 'h${u}', 'x', '+15125550100', '+14155550101')->>'ok'`);
    expect(reserved).toBe('true');
  });

  it('can be undone, to exactly what was there before, and applied again', () => {
    const definitions = (on: TestDb) => on.sql(
      "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'phone\\_%' order by p.oid::regprocedure::text");
    const earlier = startTestDb(BEFORE);
    try {
      const u = randomUUID();
      talk(u, 10);
      q(file(DOWN));
      q(file(DOWN));
      expect(definitions(db)).toBe(definitions(earlier));
      expect([used(u), left(u)]).toEqual([1, 29]);
      for (const role of ['anon', 'authenticated']) {
        expect(() => q(`set role ${role}; select phone_minutes_used('${u}', null, phone_month())`)).toThrow(/permission denied/);
      }
      q(file(UP));
      q(file(UP));
      expect([used(u), left(u)]).toEqual([0, 30]);
    } finally { earlier.stop(); }
  }, 60_000);
});
