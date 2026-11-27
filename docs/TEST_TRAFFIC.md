# Test traffic: keeping our own and robot traffic out of counts

One rule, in the database (`backend/supabase/migrations/039_test_traffic.sql`). Which accounts, browsers and installs
are ours is data in `test_traffic_rules`. **This repository is public: never commit an address, a seed file or an id
of ours.**

## What counts as test

| Reason | Matched by | Where it comes from |
|---|---|---|
| the rule's label (`owner`, `company`, `review_login`, ...) | `account_email` (with any `+alias`; Gmail dots ignored), `email_domain` (exact), `user_id`, `anon_id` | rows you insert |
| `internal_build` | `android_version`, until its `ends_at` | rows you insert |
| `reserved_domain` | `@example.com`, `.org`, `.net` | built in |
| `play_test_lab` | `@cloudtestlabaccounts.com` | built in |
| `play_robot` | Gmail address ending `.NNNNN` | built in |
| `synthetic` | address with `+mmsynth...` | built in |
| `google_network` | every sign-in session from Google's network (counts only, never stored on a row) | built in |
| `automation`, `marker` | browser driven by automation; `?mm_test=1` | web app |
| `automated_agent` | headless browser, script-running crawler, curl or Python | backend, from the user agent (not stored) |
| `client` | debug build, Test Lab, emulator, adb install | Android app |
| `same_install` | same browser or install as an earlier test row | database |

A real person matched by mistake: insert `('user_id', '<id>', 'not_test')`.

## How a row looks

A test row in `activation_events` has `props.test = true`, `props.test_reason`, and platform `web_test`,
`android_test` or `ios_test` (server rows keep `server`). A reader of `platform = 'web'` or `'android'` therefore sees
people only. To check that our own check's events arrived, look at the `_test` platforms.

```sql
-- accounts that are not people, by reason
select reason, count(*) from public.test_accounts() group by 1 order by 2 desc;
-- any count of people
select count(*) from auth.users u where u.id not in (select user_id from public.test_accounts());
```

## Apply (in this order)

1. Apply `039_test_traffic.sql`. It changes no existing row. New events start being marked.
2. Insert the rules (a private SQL file kept outside the repository). Check the counts per reason.
3. Preview `040_test_traffic_history.sql` with its last line changed to `ROLLBACK`, read the summary, then apply it.
   It re-marks old rows and points the harness view `harness.activation_users` at the same rule.
4. Deploy the backend, then the web app. Android takes effect with its next release.

Rollbacks: `backend/supabase/rollbacks/040_...down.sql`, then re-apply the harness view from the ops-notes repository,
then `039_...down.sql`.

## Every Android release

The device cannot tell the Play internal track from production, so a build that only testers have needs a rule:

```sql
-- when uploading to internal testing
insert into public.test_traffic_rules (kind, value, label, ends_at) values
  ('android_version', '<versionName>', 'internal_build', now() + interval '7 days');
-- BEFORE promoting that version to any wider track (otherwise real people are left out of the counts)
update public.test_traffic_rules set ends_at = now() where kind = 'android_version' and value = '<versionName>';
```

A rule must have an end date, so a forgotten one lets test events be counted again rather than hiding people for good.

## Not covered

- Our own use of a published build from an ordinary phone or browser, even when signed in to a test account: events
  carry no account, by design (only a test **sign-up** marks its browser). Insert the `anon_id` as a rule, or open the
  web home page with `?mm_test=1` once.
- Failure reports sent by the apps to the failure reporter, and its report-based checks (only Play test devices are
  left out there).
- Voice assistant daily gauges and spend figures include test use (they track cost and health).
- Firebase Analytics.
