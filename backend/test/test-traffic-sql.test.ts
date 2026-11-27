/**
 * Migrations 039 and 040 on a throwaway local Postgres: who counts as test traffic, how rows are marked, and that the
 * history re-mark can be undone. All addresses here are made up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgAvailable, startTestDb, type TestDb } from './helpers-pg.js';

const file = (p: string) => readFileSync(join(__dirname, '..', 'supabase', p), 'utf8');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const anon = (n: number) => `anon-0000-0000-${String(n).padStart(6, '0')}`;
const SERVER = 'server-phone-events';

/** What the real project has beyond the test bootstrap: account columns, sessions, and the harness view of ops-notes. */
const EXTRA = `
ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD COLUMN last_sign_in_at timestamptz, ADD COLUMN raw_app_meta_data jsonb;
CREATE TABLE auth.sessions (user_id uuid, ip inet, user_agent text);
CREATE ROLE harness_readonly NOLOGIN;
CREATE SCHEMA harness; GRANT USAGE ON SCHEMA harness TO harness_readonly;
CREATE VIEW harness.activation_users AS
  SELECT id, created_at, last_sign_in_at, 'x'::text AS provider, false AS is_private_relay, false AS is_internal_or_test, false AS is_synthetic
    FROM auth.users;
GRANT SELECT ON harness.activation_users TO harness_readonly;
`;

const USERS: Record<number, string> = {
  1: 'Team.Person@gmail.com',            // listed address
  2: 'teamperson+trial7@googlemail.com', // its plus alias
  3: 'team.person.jones@gmail.com',      // a real person with a similar address
  4: 'someone+news@gmail.com',           // a real person using a plus alias
  5: 'staff@ourcompany.test',            // listed domain
  6: 'staff@mail.ourcompany.test',       // not that domain
  7: 'reviewer@gmail.com',               // listed by id
  8: 'websignup@example.com',
  9: 'abc@cloudtestlabaccounts.com',
  10: 'maria.lopez.48213@gmail.com',     // Google's automated test account shape
  11: 'maria1984@gmail.com',
  12: 'runner+mmsynth20261127t1130@gmail.com',
  13: 'google.only@gmail.com',           // every session from Google's network
  14: 'google.and.home@gmail.com',
  15: 'wrong.99999@gmail.com',           // matches the robot shape but declared a real person
};

describe.skipIf(!pgAvailable)('test traffic (migrations 039 and 040)', () => {
  let db: TestDb;
  const reason = (n: number, network = true) => db.sql(`SELECT COALESCE(public.test_account_reason('${id(n)}', ${network}), '-')`);
  const insert = (a: string, o: { user?: number; platform?: string; version?: string; props?: object; at?: string; name?: string } = {}) =>
    db.sql(`INSERT INTO public.activation_events (anon_id, user_id, name, platform, app_version, props, created_at) VALUES
      ('${a}', ${o.user ? `'${id(o.user)}'` : 'NULL'}, '${o.name ?? 'landed'}', '${o.platform ?? 'web'}',
       ${o.version ? `'${o.version}'` : 'NULL'}, '${JSON.stringify(o.props ?? {})}', ${o.at ? `'${o.at}'` : 'now()'})`);
  /** platform|test reason, oldest first. */
  const rows = (a: string) => db.sql(`SELECT platform || '|' || COALESCE(props->>'test_reason', '-') FROM public.activation_events
      WHERE anon_id = '${a}' ORDER BY id`).split('\n');

  beforeAll(() => {
    db = startTestDb(['migrations/027_activation_events.sql']);
    db.sql(EXTRA);
    db.sql(file('migrations/039_test_traffic.sql'));
    db.sql(file('migrations/039_test_traffic.sql')); // safe to run twice
    for (const [n, email] of Object.entries(USERS)) db.sql(`INSERT INTO auth.users (id, email) VALUES ('${id(Number(n))}', '${email}')`);
    db.sql(`INSERT INTO auth.sessions VALUES ('${id(13)}', '66.249.66.1', 'ktor'), ('${id(13)}', '2607:f8b0::5', 'ktor'),
      ('${id(14)}', '66.249.66.1', 'ktor'), ('${id(14)}', '203.0.113.9', 'ktor'), ('${id(3)}', '203.0.113.10', 'ktor')`);
    db.sql(`INSERT INTO public.test_traffic_rules (kind, value, label, ends_at) VALUES
      ('account_email', 'teamperson@gmail.com', 'owner', NULL),
      ('email_domain', 'ourcompany.test', 'company', NULL),
      ('user_id', '${id(7)}', 'review_login', NULL),
      ('user_id', '${id(15)}', 'not_test', NULL),
      ('anon_id', '${anon(50)}', 'deploy_check', NULL),
      ('android_version', '9.9.1', 'internal_build', now() + interval '1 day'),
      ('android_version', '9.9.0', 'internal_build', now() - interval '1 day')`);
  }, 120_000);
  afterAll(() => db?.stop());
  beforeEach(() => { db.sql('DELETE FROM public.activation_events; DELETE FROM public.signup_attribution'); });

  it('classifies accounts by the listed rules and the automated shapes, and leaves similar real people alone', () => {
    const got = Object.fromEntries(Object.keys(USERS).map((n) => [Number(n), reason(Number(n))]));
    expect(got).toEqual({
      1: 'owner', 2: 'owner', 3: '-', 4: '-', 5: 'company', 6: '-', 7: 'review_login', 8: 'reserved_domain',
      9: 'play_test_lab', 10: 'play_robot', 11: '-', 12: 'synthetic', 13: 'google_network', 14: '-', 15: '-',
    });
    expect(reason(13, false)).toBe('-');
  });

  it('lists test accounts, whole and among given ids', () => {
    expect(db.sql('SELECT count(*) FROM public.test_accounts()')).toBe('9');
    expect(db.sql(`SELECT reason FROM public.test_accounts_among(ARRAY['${id(3)}','${id(5)}','${id(5)}']::uuid[])`)).toBe('company');
  });

  it('uses the Google network rule for counts only, never for what the backend asks before silencing an alert', () => {
    expect(db.sql(`SELECT reason FROM public.test_accounts() WHERE user_id = '${id(13)}'`)).toBe('google_network');
    expect(db.sql(`SELECT user_id FROM public.test_accounts_among(ARRAY['${id(13)}']::uuid[])`)).toBe('');
    insert(anon(42), { user: 13 });
    expect(rows(anon(42))).toEqual(['web|-']);
  });

  it('infers nothing about a browser a person has used: not their rows, not the browser\'s other rows', () => {
    // A person signs up in a browser, then a test account does: nothing is swept, nothing later is inferred.
    insert(anon(60));
    db.sql(`INSERT INTO public.signup_attribution (user_id, anon_id) VALUES ('${id(3)}', '${anon(60)}')`);
    db.sql(`INSERT INTO public.signup_attribution (user_id, anon_id) VALUES ('${id(8)}', '${anon(60)}')`);
    insert(anon(60), { user: 8 });
    insert(anon(60));
    insert(anon(60), { user: 3 });
    expect(rows(anon(60))).toEqual(['web|-', 'web_test|reserved_domain', 'web|-', 'web|-']);
    // A row sent with a person's account is not marked by an earlier test row or by a listed browser.
    insert(anon(61), { props: { test: true } });
    insert(anon(61), { user: 15 });  // declared 'not_test'
    insert(anon(61));                // the browser is now known to be shared
    expect(rows(anon(61))).toEqual(['web_test|client', 'web|-', 'web|-']);
    insert(anon(50), { user: 3 });
    insert(anon(50), { user: 15 });
    insert(anon(50));                // listed by the owner: rows without an account are still ours
    expect(rows(anon(50))).toEqual(['web|-', 'web|-', 'web_test|deploy_check']);
  });

  it('is closed to app users and anonymous callers', () => {
    for (const role of ['anon', 'authenticated']) {
      for (const q of ['SELECT * FROM public.test_traffic_rules', 'SELECT * FROM public.test_accounts()',
        `SELECT public.test_account_reason('${id(1)}')`, `SELECT public.test_mark_anon('${anon(1)}', 'x')`]) {
        expect(() => db.sql(`SET ROLE ${role}; ${q}`)).toThrow(/permission denied/);
      }
    }
  });

  it('works for the server role: it can ask, and the rows it inserts are marked', () => {
    expect(db.sql(`SET ROLE service_role; SELECT reason FROM public.test_accounts_among(ARRAY['${id(1)}']::uuid[])`)).toBe('owner');
    db.sql(`SET ROLE service_role; INSERT INTO public.activation_events (anon_id, user_id, name, platform) VALUES ('${anon(40)}', '${id(1)}', 'landed', 'web');
      INSERT INTO public.signup_attribution (user_id, anon_id) VALUES ('${id(8)}', '${anon(41)}')`);
    expect(rows(anon(40))).toEqual(['web_test|owner']);
  });

  it('refuses a version rule that never ends', () => {
    expect(() => db.sql(`INSERT INTO public.test_traffic_rules (kind, value, label) VALUES ('android_version', '1.0', 'internal_build')`)).toThrow(/check constraint/);
  });

  it('leaves a real event exactly as sent', () => {
    insert(anon(1));
    insert(anon(2), { platform: 'android', version: '9.9.2', props: { test: false } });
    insert(anon(3), { user: 3 });
    expect(rows(anon(1))).toEqual(['web|-']);
    expect(rows(anon(2))).toEqual(['android|-']);
    expect(rows(anon(3))).toEqual(['web|-']);
  });

  it('moves a row the sender calls test off the real platform, and the rest of that browser with it', () => {
    insert(anon(4), { props: { test: true, test_reason: 'automation' } });
    insert(anon(4));
    insert(anon(5), { platform: 'android', props: { test: true } });
    expect(rows(anon(4))).toEqual(['web_test|automation', 'web_test|same_install']);
    expect(rows(anon(5))).toEqual(['android_test|client']);
    expect(db.sql(`SELECT count(*) FROM public.activation_events WHERE platform IN ('web', 'android')`)).toBe('0');
  });

  it('marks by account and by listed browser', () => {
    insert(anon(6), { user: 1, platform: 'android' });
    insert(anon(50));
    expect(rows(anon(6))).toEqual(['android_test|owner']);
    expect(rows(anon(50))).toEqual(['web_test|deploy_check']);
  });

  it('marks a test-only build only while its rule runs, and counts that install again afterwards', () => {
    insert(anon(7), { platform: 'android', version: '9.9.1' });
    insert(anon(7), { platform: 'android', version: '9.9.2' }); // the same phone on a published build
    insert(anon(8), { platform: 'android', version: '9.9.0' }); // rule over
    insert(anon(9), { platform: 'web', version: '9.9.1' });     // versions are Android's
    expect(rows(anon(7))).toEqual(['android_test|internal_build', 'android|-']);
    expect(rows(anon(8))).toEqual(['android|-']);
    expect(rows(anon(9))).toEqual(['web|-']);
  });

  it('keeps the server rows on their platform and never spreads a mark between accounts through them', () => {
    insert(SERVER, { user: 1, platform: 'server' });
    insert(SERVER, { user: 3, platform: 'server' });
    expect(rows(SERVER)).toEqual(['server|owner', 'server|-']);
  });

  it('marks a browser when a test account signs up in it, and the marks outlive the account', () => {
    insert(anon(10), { name: 'landed' });
    insert(anon(10), { name: 'signup_started' });
    insert(anon(11));
    db.sql(`INSERT INTO public.signup_attribution (user_id, anon_id) VALUES ('${id(8)}', '${anon(10)}'), ('${id(3)}', '${anon(11)}')`);
    insert(anon(10), { name: 'summary_viewed' });
    db.sql(`DELETE FROM public.signup_attribution`);
    expect(rows(anon(10))).toEqual(['web_test|reserved_domain', 'web_test|reserved_domain', 'web_test|same_install']);
    expect(rows(anon(11))).toEqual(['web|-']);
  });

  it('never loses an event when the rule itself fails', () => {
    db.sql('ALTER TABLE public.test_traffic_rules RENAME TO test_traffic_rules_gone');
    try {
      insert(anon(12));
      expect(rows(anon(12))).toEqual(['web|-']);
    } finally {
      db.sql('ALTER TABLE public.test_traffic_rules_gone RENAME TO test_traffic_rules');
    }
  });

  it('re-marks history, points the harness view at the rule, and undoes both', () => {
    db.sql('ALTER TABLE public.activation_events DISABLE TRIGGER activation_events_mark_test');
    db.sql('ALTER TABLE public.signup_attribution DISABLE TRIGGER signup_attribution_mark_test');
    insert(anon(20));                                                          // real
    insert(anon(21), { platform: 'android', props: { test: true } });          // already said test
    insert(anon(22), { user: 1, platform: 'android' });                        // by account
    insert(anon(50));                                                          // listed browser
    insert(anon(23)); insert(anon(23), { name: 'signup_done' });               // test signup in this browser
    db.sql(`INSERT INTO public.signup_attribution (user_id, anon_id) VALUES ('${id(8)}', '${anon(23)}')`);
    insert(anon(24), { platform: 'android', version: '9.9.0', at: '2020-01-01T00:00:00Z' }); // test-only build then
    insert(anon(25), { platform: 'android', version: '9.9.0' });               // the same version after its rule ended
    insert(anon(26), { platform: 'android', props: { test: true } });
    insert(anon(26), { platform: 'android' });                                 // same install
    insert(SERVER, { user: 3, platform: 'server' });
    insert(anon(27), { user: 1, platform: 'android', props: { test: false } });   // said it was not a test
    insert(anon(28), { platform: 'android', props: { test: true } });
    insert(anon(28), { platform: 'android', props: { test: false, seconds: 4 } }); // same install
    insert(anon(29));                                                              // a browser two people share
    db.sql(`INSERT INTO public.signup_attribution (user_id, anon_id) VALUES ('${id(3)}', '${anon(29)}'), ('${id(12)}', '${anon(29)}')`);
    insert(anon(31), { props: { test: true } });
    insert(anon(31), { user: 15 });                                                // declared 'not_test'
    insert(anon(31));
    insert(anon(50), { user: 3 });                                                 // a person's row in a listed browser
    db.sql('ALTER TABLE public.activation_events ENABLE TRIGGER activation_events_mark_test');
    db.sql('ALTER TABLE public.signup_attribution ENABLE TRIGGER signup_attribution_mark_test');
    const snapshot = () => db.sql('SELECT id, platform, props::text FROM public.activation_events ORDER BY id');
    const before = snapshot();

    db.sql(file('migrations/040_test_traffic_history.sql'));
    db.sql(file('migrations/040_test_traffic_history.sql')); // safe to run twice
    expect(rows(anon(20))).toEqual(['web|-']);
    expect(rows(anon(21))).toEqual(['android_test|-']);
    expect(rows(anon(22))).toEqual(['android_test|owner']);
    expect(rows(anon(50))).toEqual(['web_test|deploy_check', 'web|-']);
    expect(rows(anon(27))).toEqual(['android_test|owner']);
    expect(rows(anon(28))).toEqual(['android_test|-', 'android_test|same_install']);
    expect(rows(anon(29))).toEqual(['web|-']);
    expect(rows(anon(31))).toEqual(['web_test|-', 'web|-', 'web|-']);
    expect(rows(anon(23))).toEqual(['web_test|reserved_domain', 'web_test|reserved_domain']);
    expect(rows(anon(24))).toEqual(['android_test|internal_build']);
    expect(rows(anon(25))).toEqual(['android|-']);
    expect(rows(anon(26))).toEqual(['android_test|-', 'android_test|same_install']);
    expect(rows(SERVER)).toEqual(['server|-']);
    expect(db.sql(`SET ROLE harness_readonly;
      SELECT count(*) FILTER (WHERE is_internal_or_test), count(*) FILTER (WHERE NOT is_internal_or_test), count(*) FILTER (WHERE is_synthetic)
        FROM harness.activation_users`)).toBe('9|6|1');

    expect(db.sql(`SELECT props->>'test_was' FROM public.activation_events WHERE anon_id = '${anon(27)}'`)).toBe('false');

    db.sql(file('rollbacks/040_test_traffic_history_down.sql'));
    expect(snapshot()).toBe(before); // including the rows that had test: false
  });

  it('refuses to re-mark history before any account rule exists', () => {
    db.sql(`CREATE TABLE rules_copy AS TABLE public.test_traffic_rules; DELETE FROM public.test_traffic_rules WHERE kind IN ('account_email', 'user_id')`);
    try {
      expect(() => db.sql(file('migrations/040_test_traffic_history.sql'))).toThrow(/no account rule/);
    } finally {
      db.sql(`DELETE FROM public.test_traffic_rules; INSERT INTO public.test_traffic_rules SELECT * FROM rules_copy; DROP TABLE rules_copy`);
    }
  });

  it('rolls 039 back once the harness view no longer uses it', () => {
    db.sql('DROP VIEW harness.activation_users');
    db.sql(file('rollbacks/039_test_traffic_down.sql'));
    expect(db.sql(`SELECT to_regclass('public.test_traffic_rules') IS NULL`)).toBe('t');
    insert(anon(30), { props: { test: true } });
    expect(rows(anon(30))).toEqual(['web|-']);
  });
});
