/** Spend and routing rules of shared numbers, personal numbers, incoming calls and agents (migration 033). */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pgAvailable, startTestDb, type TestDb } from './helpers-pg.js';

const MIGRATIONS = [
  'migrations/007_phone_calls.sql', 'migrations/022_phone_calls_updated_at.sql', 'migrations/027_activation_events.sql',
  'migrations/032_phone_calls_repair.sql', 'migrations/033_phone_numbers_agents.sql', 'migrations/033_phone_numbers_agents.sql',
];
const CAP = 25_000_000;
let db: TestDb;
const run = pgAvailable ? describe : describe.skip;

run('phone numbers and agents (SQL)', () => {
  beforeAll(() => { db = startTestDb(MIGRATIONS); }, 60_000);
  afterAll(() => db?.stop());
  beforeEach(() => db.sql('truncate phone_ledger, phone_halts, phone_numbers, phone_return_routes, phone_subscriptions, verified_phones cascade'));

  const q = (s: string) => db.sql(s);
  const json = (s: string) => JSON.parse(q(`select ${s}`));
  const spent = () => Number(q('select phone_month_spent(phone_month())'));
  let n = 0;
  const number = (kind: 'pool' | 'personal', user: string | null = null, country = 'US') => {
    const id = randomUUID();
    q(`insert into phone_numbers (id, phone_number, country, kind, user_id, status) values ('${id}', '+1512455${String(++n).padStart(4, '0')}', '${country}', '${kind}', ${user ? `'${user}'` : 'null'}, 'active')`);
    return id;
  };
  const verified = (user: string) => {
    const id = randomUUID();
    q(`insert into auth.users values ('${user}') on conflict do nothing`);
    q(`insert into verified_phones (id, user_id, phone_number, status) values ('${id}', '${user}', '+1415455${String(++n).padStart(4, '0')}', 'verified')`);
    return id;
  };
  const subscribe = (user: string, call = 6000, agent = 1800, expires = "now() + interval '20 days'", state = 'SUBSCRIPTION_STATE_ACTIVE') =>
    q(`insert into phone_subscriptions (user_id, product_id, token_hash, purchase_token, state, period_start, expires_at, call_seconds, agent_seconds)
       values ('${user}', 'p', '${randomUUID()}', 't', '${state}', now() - interval '10 days', ${expires}, ${call}, ${agent})`);
  const leg = (kind: string, user: string, company: boolean, sid: string | null = `CA${randomUUID()}`) => {
    const call = randomUUID();
    return { call, ...json(`phone_reserve_leg('${kind}', '${call}', '${user}', null, 'h${user}', 'r', '+15124550100', '+14154550100', ${sid ? `'${sid}'` : 'null'}, ${company})`) };
  };

  it('a return call reaches exactly one user: the same caller never gets the same shared number from two users', () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const [pa, pb, pc] = [verified(a), verified(b), verified(c)];
    const us = number('pool'); const ca = number('pool', null, 'CA');
    const first = json(`phone_assign_route('${a}', '${pa}', 'bob', 'CA')`);
    expect(first.number_id).toBe(ca);
    expect(json(`phone_assign_route('${a}', '${pa}', 'bob', 'US')`).number_id).toBe(ca); // stays the same for the same person
    expect(json(`phone_assign_route('${b}', '${pb}', 'bob', 'CA')`).number_id).toBe(us);
    expect(json(`phone_assign_route('${c}', '${pc}', 'bob', 'US')`)).toMatchObject({ ok: false, reason: 'no_shared_number' });
    expect(json(`phone_assign_route('${c}', '${pc}', 'alice', 'US')`).ok).toBe(true);
    q("update phone_return_routes set expires_at = now() - interval '1 minute' where remote_hash = 'bob'");
    expect(json(`phone_assign_route('${c}', '${pc}', 'bob', 'US')`).ok).toBe(true);
    expect(json(`phone_assign_route('${c}', '${pa}', 'x', 'US')`)).toMatchObject({ ok: false, reason: 'not_verified' });
  });

  it('shared number rent is company money, booked once a month, and a purchase must fit the cap', () => {
    const id = number('pool');
    expect(json(`phone_book_rent('${id}', true)`)).toMatchObject({ ok: true, funding: 'company', over_cap: false });
    expect(json(`phone_book_rent('${id}', true)`)).toMatchObject({ ok: true, already: true });
    expect(spent()).toBe(1_500_000);
    q(`insert into phone_ledger (kind, month, reserved_micro, actual_micro, state) values ('call', phone_month(), 0, ${CAP - 2_000_000}, 'settled')`);
    const other = number('pool');
    expect(json(`phone_book_rent('${other}', true)`)).toMatchObject({ ok: false, reason: 'budget_used' });
    expect(json(`phone_book_rent('${other}', false)`)).toMatchObject({ ok: true, over_cap: true });
  });

  it('allows only a few shared numbers', () => {
    for (let i = 0; i < 4; i++) expect(json(`phone_book_rent('${number('pool')}', true)`).ok).toBe(true);
    expect(json(`phone_book_rent('${number('pool')}', true)`)).toMatchObject({ ok: false, reason: 'pool_full' });
  });

  it('a subscriber pays the own number and included time; none of it counts against the company cap', () => {
    const u = randomUUID();
    subscribe(u, 120, 60);
    expect(json(`phone_book_rent('${number('personal', u)}', true)`)).toMatchObject({ ok: true, funding: 'subscription' });
    const a = leg('inbound', u, false);
    expect(a).toMatchObject({ ok: true, limit_seconds: 120, funding: 'subscription' });
    expect(leg('agent', u, false)).toMatchObject({ ok: false, reason: 'call_in_progress' });
    expect(json(`phone_settle_leg('${a.call}', 61)`)).toMatchObject({ ok: true, over_reservation: false });
    expect(q(`select phone_sub_left('${u}', 'call')`)).toBe('0'); // two started minutes
    expect(leg('inbound', u, false)).toMatchObject({ ok: false, reason: 'included_used' });
    const b = leg('agent', u, false);
    expect(b.limit_seconds).toBe(60);
    json(`phone_settle_leg('${b.call}', 10)`);
    expect(leg('agent', u, false)).toMatchObject({ ok: false, reason: 'included_used' });
    expect(spent()).toBe(0);
  });

  it('included time ends with the subscription', () => {
    const u = randomUUID();
    subscribe(u, 600, 600, "now() - interval '1 minute'");
    expect(leg('inbound', u, false)).toMatchObject({ ok: false, reason: 'included_used' });
    const v = randomUUID();
    subscribe(v, 600, 600, "now() + interval '1 day'", 'SUBSCRIPTION_STATE_ON_HOLD');
    expect(leg('inbound', v, false)).toMatchObject({ ok: false, reason: 'included_used' });
    expect(() => q(`insert into phone_subscriptions values (gen_random_uuid(), 'p', 'x', 't', 's', now(), now(), 999999, 0)`)).toThrow(/check/);
  });

  it('forwarding on a shared number uses the free minutes and the cap', () => {
    const u = randomUUID();
    const a = leg('inbound', u, true);
    expect(a).toMatchObject({ ok: true, limit_seconds: 1800, funding: 'company' });
    json(`phone_settle_leg('${a.call}', 1800)`);
    expect(leg('inbound', u, true)).toMatchObject({ ok: false, reason: 'user_minutes_used' });
    expect(json(`phone_budget('${u}', null)`).minutes_left).toBe(0);
    q(`insert into phone_ledger (kind, month, reserved_micro, actual_micro, state) values ('call', phone_month(), 0, ${CAP}, 'settled')`);
    expect(leg('inbound', randomUUID(), true)).toMatchObject({ ok: false, reason: 'budget_used' });
  });

  it('the same carrier call is never reserved twice', () => {
    const u = randomUUID();
    subscribe(u);
    const a = leg('inbound', u, false, 'CAsame');
    json(`phone_settle_leg('${a.call}', 5)`);
    expect(leg('inbound', u, false, 'CAsame')).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('free agent minutes (testers) are limited and paid within the cap', () => {
    const u = randomUUID();
    const a = leg('agent', u, true);
    expect(a.limit_seconds).toBe(600);
    expect(spent()).toBe(10 * 150_000 + 30_000);
    json(`phone_settle_leg('${a.call}', 600)`);
    expect(leg('agent', u, true)).toMatchObject({ ok: false, reason: 'user_minutes_used' });
  });

  it('agent drafts are booked first, limited per day and refused at the cap', () => {
    const u = randomUUID();
    for (let i = 0; i < 5; i++) expect(json(`phone_reserve_draft('${u}')`).ok).toBe(true);
    expect(json(`phone_reserve_draft('${u}')`)).toMatchObject({ ok: false, reason: 'user_limit' });
    q(`insert into phone_ledger (kind, month, reserved_micro, actual_micro, state) values ('call', phone_month(), 0, ${CAP}, 'settled')`);
    expect(json(`phone_reserve_draft('${randomUUID()}')`)).toMatchObject({ ok: false, reason: 'budget_used' });
  });

  it('app clients reach none of it', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const s of ['select * from phone_numbers', 'select * from phone_subscriptions', 'select * from phone_return_routes',
        `select phone_reserve_draft('${randomUUID()}')`, "select phone_sub_left(gen_random_uuid(), 'call')", `select phone_book_rent(gen_random_uuid(), false)`]) {
        expect(() => q(`set role ${role}; ${s}`), `${role}: ${s}`).toThrow(/permission denied/);
      }
    }
  });
});
