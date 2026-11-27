/**
 * The spend control of phone calls (migration 032), run against a real local Postgres: monthly cap, per-user minutes,
 * rate limits, single-use claims, settlement, client access and the funnel. Skipped where no Postgres is installed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pgAvailable, startTestDb, type TestDb } from './helpers-pg.js';

const MIGRATIONS = [
  'migrations/007_phone_calls.sql', 'migrations/022_phone_calls_updated_at.sql',
  'migrations/027_activation_events.sql', 'migrations/032_phone_calls_repair.sql', 'migrations/037_phone_minutes_shown.sql',
];
const CAP = 25_000_000;
let db: TestDb;

const run = pgAvailable ? describe : describe.skip;

run('phone spend control (SQL)', () => {
  beforeAll(() => { db = startTestDb(MIGRATIONS); }, 60_000);
  afterAll(() => db?.stop());
  beforeEach(() => db.sql('truncate phone_ledger, phone_halts, activation_events, verified_phones, phone_calls'));

  const q = (s: string) => db.sql(s);
  const json = (s: string) => JSON.parse(q(`select ${s}`));
  const hash = (n: number | string) => `h${n}`;
  let dest = 0;
  const reserve = (user: string, o: { call?: string; from?: string; dest?: string } = {}) => {
    const call = o.call ?? randomUUID();
    return { call, ...json(`phone_reserve_call('${call}', '${user}', '${o.from ?? hash(user)}', '${o.dest ?? `d${++dest}`}', '+15125550100', '+14155550101')`) };
  };
  const claim = (call: string, user: string, sid = `CA${call.slice(0, 8)}`) => json(`phone_claim_call('${call}', '${user}', '${sid}')`);
  const settle = (call: string, app: number, talk: number, unknown = false) => json(`phone_settle_call('${call}', ${app}, ${talk}, ${unknown})`);
  const spent = () => Number(q('select phone_month_spent(phone_month())'));
  const age = (call: string, interval: string) => q(`update phone_ledger set created_at = now() - interval '${interval}' where call_id = '${call}'`);
  /** Moves every row out of the rate-limit windows while keeping it in this month's money and minutes. */
  const forgetRates = () => q("update phone_ledger set created_at = now() - interval '40 days'");

  it('the limits are the approved ones, in one place', () => {
    const l = json('phone_limits()');
    expect([l.cap_micro, l.user_minutes]).toEqual([CAP, 30]);
  });

  it('a first call gets 30 minutes and reserves its worst case before anything is dialled', () => {
    const u = randomUUID();
    const r = reserve(u);
    expect(r).toMatchObject({ ok: true, limit_seconds: 1800, minutes_left: 30 });
    expect(spent()).toBe(30 * 33_000 + 55_000);
  });

  it('the worst real call never costs more than was reserved', () => {
    const u = randomUUID();
    const { call } = reserve(u);
    claim(call, u);
    // talk fills the limit, the app leg adds the notice, ringing and rounding
    const r = settle(call, 1800 + 60, 1800 - 7);
    expect(r).toMatchObject({ ok: true, over_reservation: false });
    expect(r.cost_micro).toBeLessThanOrEqual(30 * 33_000 + 55_000);
    expect(spent()).toBe(r.cost_micro);
  });

  it('charges started minutes against the 30, and an unanswered call uses none', () => {
    const u = randomUUID();
    const a = reserve(u); claim(a.call, u); settle(a.call, 70, 61); // 2 minutes
    const b = reserve(u); claim(b.call, u); settle(b.call, 40, 0);
    expect(json(`phone_budget('${u}', '${hash(u)}')`).minutes_left).toBe(28);
    const unanswered = q(`select actual_micro from phone_ledger where call_id = '${b.call}'`);
    expect(Number(unanswered)).toBe(5_000 + 15_000);
    expect(reserve(u).limit_seconds).toBe(28 * 60);
  });

  it('stops a user at 30 minutes, also across two accounts that share the number', () => {
    const a = randomUUID();
    const c = reserve(a, { from: 'same' }); claim(c.call, a); settle(c.call, 1800, 1790);
    expect(reserve(a, { from: 'same' })).toMatchObject({ ok: false, reason: 'user_minutes_used' });
    expect(reserve(randomUUID(), { from: 'same' })).toMatchObject({ ok: false, reason: 'user_minutes_used' });
    expect(reserve(a, { from: 'another' })).toMatchObject({ ok: false, reason: 'user_minutes_used' });
  });

  it('shows only the time a call in progress has run, while the whole reservation still counts against a new call', () => {
    const u = randomUUID();
    const left = () => json(`phone_budget('${u}', '${hash(u)}')`).minutes_left;
    const c = reserve(u);
    expect(left()).toBe(30); // nothing dialled yet
    claim(c.call, u);
    q(`update phone_ledger set claimed_at = now() - interval '90 seconds' where call_id = '${c.call}'`);
    expect(left()).toBe(28); // two started minutes so far
    expect(reserve(u)).toMatchObject({ ok: false, reason: 'call_in_progress' });
    expect(q(`select phone_minutes_used('${u}', null, phone_month())`)).toBe('30');
    q(`update phone_ledger set claimed_at = now() - interval '2 hours' where call_id = '${c.call}'`);
    expect(left()).toBe(0); // never past the reservation
    settle(c.call, 20, 8);
    expect(left()).toBe(29);
  });

  it('can be undone and applied again (037)', () => {
    const file = (f: string) => readFileSync(join(__dirname, '..', 'supabase', f), 'utf8');
    const u = randomUUID();
    const c = reserve(u); claim(c.call, u);
    q(file('rollbacks/037_phone_minutes_shown_down.sql'));
    expect(json(`phone_budget('${u}', null)`).minutes_left).toBe(0); // the old figure
    q(file('migrations/037_phone_minutes_shown.sql'));
    q(file('migrations/037_phone_minutes_shown.sql'));
    expect(json(`phone_budget('${u}', null)`).minutes_left).toBeGreaterThanOrEqual(29);
    for (const role of ['anon', 'authenticated']) {
      expect(() => q(`set role ${role}; select phone_minutes_shown('${u}', null, phone_month())`)).toThrow(/permission denied/);
    }
  });

  it('allows one call at a time; a reservation never connected is dropped by the next one', () => {
    const u = randomUUID();
    const first = reserve(u);
    const second = reserve(u);
    expect(second.ok).toBe(true);
    expect(claim(first.call, u)).toMatchObject({ ok: false });
    expect(claim(second.call, u)).toMatchObject({ ok: true });
    expect(reserve(u)).toMatchObject({ ok: false, reason: 'call_in_progress' });
    expect(reserve(randomUUID(), { from: hash(u) })).toMatchObject({ ok: false, reason: 'call_in_progress' });
  });

  it('a reservation is dialled once, only by its owner, only shortly after it was made', () => {
    const u = randomUUID();
    const c = reserve(u);
    expect(claim(c.call, randomUUID())).toMatchObject({ ok: false });
    expect(claim(c.call, u)).toMatchObject({ ok: true, to_number: '+14155550101', from_number: '+15125550100', limit_seconds: 1800 });
    expect(claim(c.call, u, 'CAother')).toMatchObject({ ok: false });
    const late = randomUUID();
    const d = reserve(late);
    age(d.call, '121 seconds');
    expect(claim(d.call, late)).toMatchObject({ ok: false });
  });

  it('releases unused reservations, never connected ones only', () => {
    const a = randomUUID(); const b = randomUUID();
    const x = reserve(a); const y = reserve(b); claim(y.call, b);
    age(x.call, '4 minutes'); age(y.call, '4 minutes');
    expect(q('select phone_release_stale()')).toBe('1');
    expect(q(`select state || '|' || coalesce(to_number, '-') from phone_ledger where call_id = '${x.call}'`)).toBe('released|-');
    expect(q(`select state from phone_ledger where call_id = '${y.call}'`)).toBe('reserved');
  });

  it('hang-up before connecting releases; after connecting it does not', () => {
    const u = randomUUID();
    const c = reserve(u);
    expect(q(`select phone_release_call('${c.call}', '${randomUUID()}')`)).toBe('f');
    expect(q(`select phone_release_call('${c.call}', '${u}')`)).toBe('t');
    expect(spent()).toBe(0);
    const d = reserve(u); claim(d.call, u);
    expect(q(`select phone_release_call('${d.call}', '${u}')`)).toBe('f');
  });

  it('settles once, forgets the numbers, and keeps the whole reservation when the carrier cannot be asked', () => {
    const u = randomUUID();
    const c = reserve(u);
    expect(settle(c.call, 10, 0)).toMatchObject({ ok: false }); // never connected
    claim(c.call, u);
    expect(settle(c.call, 0, 0, true)).toMatchObject({ ok: true, cost_micro: 30 * 33_000 + 55_000 });
    expect(settle(c.call, 10, 0)).toMatchObject({ ok: false });
    expect(q(`select coalesce(to_number, '') || coalesce(from_number, '') from phone_ledger where call_id = '${c.call}'`)).toBe('');
  });

  it('records the notice only for the dialled call', () => {
    const u = randomUUID();
    const c = reserve(u);
    expect(q(`select phone_notice_served('${c.call}', 'CAx')`)).toBe('f');
    claim(c.call, u, 'CAx');
    expect(q(`select phone_notice_served('${c.call}', 'CAy')`)).toBe('f');
    expect(q(`select phone_notice_served('${c.call}', 'CAx')`)).toBe('t');
  });

  it('shortens calls to what the month can still pay and then refuses: US$25 is never exceeded', () => {
    let shortest = 1800;
    let refused = '';
    for (let i = 0; i < 60; i++) {
      const u = randomUUID();
      const r = reserve(u);
      if (!r.ok) { refused = r.reason; break; }
      shortest = Math.min(shortest, r.limit_seconds);
      claim(r.call, u);
      settle(r.call, r.limit_seconds + 60, r.limit_seconds - 1);
      forgetRates();
    }
    // Full-length calls first, then ever shorter ones.
    for (let i = 0; i < 40 && !refused; i++) {
      const r = reserve(randomUUID());
      if (!r.ok) refused = r.reason; else shortest = Math.min(shortest, r.limit_seconds);
    }
    expect(refused).toBe('budget_used');
    expect(shortest).toBeLessThan(1800);
    expect(spent()).toBeLessThanOrEqual(CAP);
    expect(CAP - spent()).toBeLessThan(33_000 + 55_000);
  }, 60_000);

  it('simultaneous reservations cannot overshoot the cap', async () => {
    // Leave room for about two full calls.
    q(`insert into phone_ledger (kind, month, reserved_micro, actual_micro, state) values ('call', phone_month(), 0, ${CAP - 2_200_000}, 'settled')`);
    const one = () => new Promise<string>((resolve, reject) => {
      const u = randomUUID();
      const p = spawn(db.psql, ['-h', db.socketDir, '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c',
        `select phone_reserve_call('${randomUUID()}', '${u}', '${u}', '${u}', '+15125550100', '+14155550101')`], { env: { ...process.env, LC_ALL: 'C' } });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`psql ${code}`))));
    });
    const results = (await Promise.all(Array.from({ length: 12 }, one))).map((s) => JSON.parse(s));
    expect(results.filter((r) => r.ok).length).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.reason === 'budget_used')).toBe(true);
    expect(spent()).toBeLessThanOrEqual(CAP);
  }, 60_000);

  it('limits call attempts per user, per destination and overall', () => {
    const u = randomUUID();
    const done = (r: { call: string }, who = u) => { claim(r.call, who); settle(r.call, 10, 0); };
    for (let i = 0; i < 6; i++) done(reserve(u));
    expect(reserve(u)).toMatchObject({ ok: false, reason: 'user_limit' });
    forgetRates();
    for (let i = 0; i < 4; i++) done(reserve(u, { dest: 'victim' }));
    expect(reserve(u, { dest: 'victim' })).toMatchObject({ ok: false, reason: 'destination_limit' });
    for (let i = 0; i < 2; i++) { const w = randomUUID(); done(reserve(w, { dest: 'victim' }), w); }
    expect(reserve(randomUUID(), { dest: 'victim' })).toMatchObject({ ok: false, reason: 'destination_limit' });
    forgetRates();
    q("insert into phone_ledger (kind, month, reserved_micro, actual_micro, state, user_id) select 'call', phone_month() - 40, 0, 0, 'settled', gen_random_uuid() from generate_series(1, 100)");
    expect(reserve(randomUUID())).toMatchObject({ ok: false, reason: 'service_limit' });
  });

  it('bad arguments raise instead of reserving', () => {
    expect(() => q(`select phone_reserve_call('${randomUUID()}', '${randomUUID()}', 'a', 'b', '5125550100', '+14155550101')`)).toThrow(/bad argument/);
    expect(() => q(`select phone_reserve_call('${randomUUID()}', '${randomUUID()}', 'a', 'b', '+15125550100', '+447700900000')`)).toThrow(/bad argument/);
    expect(spent()).toBe(0);
  });

  const verify = (user: string, number: string) => json(`phone_reserve_verification('${user}', '${number}')`);
  const later = (interval: string) => q(`update phone_ledger set created_at = created_at - interval '${interval}'`);

  it('books every verification call and limits them per user, number and time', () => {
    const u = randomUUID();
    expect(verify(u, 'n1')).toMatchObject({ ok: true });
    expect(spent()).toBe(50_000);
    expect(verify(u, 'n2')).toMatchObject({ ok: false, reason: 'too_soon' });
    later('2 minutes');
    expect(verify(randomUUID(), 'n1')).toMatchObject({ ok: false, reason: 'number_busy' });
    expect(verify(u, 'n1')).toMatchObject({ ok: true }); later('2 minutes');
    expect(verify(u, 'n1')).toMatchObject({ ok: true }); later('11 minutes');
    expect(verify(u, 'n3')).toMatchObject({ ok: false, reason: 'user_limit' });
    expect(verify(randomUUID(), 'n1')).toMatchObject({ ok: false, reason: 'number_limit' });
  });

  it('a verification call the carrier refused costs nothing but still counts as an attempt', () => {
    const u = randomUUID();
    const r = verify(u, 'n1');
    q(`select phone_release_verification(${r.ledger_id})`);
    expect(spent()).toBe(0);
    expect(verify(u, 'n1')).toMatchObject({ ok: false, reason: 'too_soon' });
  });

  it('verification calls stay within their own share and the cap', () => {
    for (let i = 0; i < 20; i++) expect(verify(randomUUID(), `n${i}`).ok).toBe(true);
    expect(verify(randomUUID(), 'x')).toMatchObject({ ok: false, reason: 'service_limit' });
    q("update phone_ledger set created_at = now() - interval '2 days'");
    q(`insert into phone_ledger (kind, month, reserved_micro, actual_micro, state, created_at) values ('verify', phone_month(), 0, ${3_000_000 - 1_000_000}, 'settled', now() - interval '3 days')`);
    expect(verify(randomUUID(), 'x')).toMatchObject({ ok: false, reason: 'budget_used' });
  });

  it('the carrier usage alarm stops everything for the month', () => {
    const u = randomUUID();
    const c = reserve(u);
    q("select phone_halt('carrier_usage_alarm')");
    expect(claim(c.call, u)).toMatchObject({ ok: false, reason: 'budget_used' });
    expect(reserve(randomUUID())).toMatchObject({ ok: false, reason: 'budget_used' });
    expect(verify(randomUUID(), 'n')).toMatchObject({ ok: false, reason: 'budget_used' });
    expect(json(`phone_budget('${u}', null)`).halted).toBe(true);
  });

  it('one number has one verified owner', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    q(`insert into auth.users values ('${a}'), ('${b}') on conflict do nothing`);
    q(`insert into verified_phones (user_id, phone_number, status) values ('${a}', '+15125550100', 'verified')`);
    expect(() => q(`insert into verified_phones (user_id, phone_number, status) values ('${b}', '+15125550100', 'verified')`)).toThrow(/one_owner/);
    q(`insert into verified_phones (user_id, phone_number) values ('${b}', '+15125550100')`);
  });

  it('app clients can neither read the ledger, nor run the functions, nor write call rows', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const statement of [
        'select * from phone_ledger', 'select * from phone_halts', 'delete from phone_ledger',
        "select phone_halt('x')", 'select phone_release_stale()', `select phone_budget('${randomUUID()}', null)`, 'select phone_funnel(now())',
        `select phone_reserve_verification('${randomUUID()}', 'n')`,
        `select phone_settle_call('${randomUUID()}', 0, 0, false)`,
        `insert into phone_calls (user_id, from_number, to_number) values ('${randomUUID()}', 'a', 'b')`,
        'update phone_calls set recording_sid = null', 'delete from phone_calls',
        "insert into activation_events (anon_id, name) values ('aaaaaaaaaaaaaaaaaaaa', 'phone_step')",
      ]) {
        expect(() => q(`set role ${role}; ${statement}`), `${role}: ${statement}`).toThrow(/permission denied/);
      }
    }
    expect(q("set role service_role; select phone_limits()->>'cap_micro'")).toBe(String(CAP));
  });

  it('the funnel splits by business answer and country, counts week-2 repeat use and leaves tests out', () => {
    const add = (u: string, step: string, daysAgo: number, extra = '') =>
      q(`insert into activation_events (anon_id, user_id, name, platform, props, created_at) values ('server-phone-events', '${u}', 'phone_step', 'server', '{"step":"${step}"${extra}}', now() - interval '${daysAgo} days')`);
    const [biz, home, tester] = [randomUUID(), randomUUID(), randomUUID()];
    add(biz, 'tab_opened', 30); add(biz, 'verify_ok', 30, ',"country":"CA"'); add(biz, 'business_answer', 30, ',"answer":"business"');
    add(biz, 'call_connected', 29); add(biz, 'call_connected', 20); add(biz, 'cap_hit', 20);
    add(home, 'tab_opened', 20, ',"country":"US"'); add(home, 'business_answer', 20, ',"answer":"skipped"'); add(home, 'call_connected', 20);
    add(tester, 'tab_opened', 20); add(tester, 'call_connected', 20, ',"test":true');
    const rows = q("select segment, country, tab_opened, verified, connected, week2_eligible, week2_repeat, cap_hit from phone_funnel(now() - interval '60 days')").split('\n');
    expect(rows).toEqual(['business|CA|1|1|1|1|1|1', 'skipped|US|1|0|1|1|0|0']);
  });

  it('can be applied again and rolled back', () => {
    const file = (p: string) => readFileSync(join(__dirname, '..', 'supabase', p), 'utf8');
    const scratch = startTestDb([...MIGRATIONS, 'migrations/032_phone_calls_repair.sql']);
    try {
      scratch.sql(file('rollbacks/037_phone_minutes_shown_down.sql'));
      scratch.sql(file('rollbacks/032_phone_calls_repair_down.sql'));
      expect(scratch.sql("select count(*) from pg_proc where proname like 'phone\\_%'")).toBe('0');
    } finally { scratch.stop(); }
  }, 60_000);
});
