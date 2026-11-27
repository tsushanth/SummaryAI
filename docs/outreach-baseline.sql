-- MeetingMind: signups after an email send vs a 14-day baseline. Read-only (Supabase SQL editor, service role).
-- Use it when link attribution is not available (the announcement went out without utm links): compares new accounts in the
-- N days after the send with the N days before it. A lift is a hint, not proof: other channels move at the same time.
-- Change the three values in `params`. Past sends: 2026-10-30 and 2026-11-13 (announcement lifts).
with params as (
  select timestamptz '2026-11-13 17:00:00+00' as send_at,   -- when the campaign went out (UTC; take it from the sender log or outreach_events in the Calldesk project)
         14                                   as days        -- window length on each side
), windows as (
  select 'before' as w, send_at - make_interval(days => days) as lo, send_at as hi, days from params
  union all
  select 'after',       send_at,                              send_at + make_interval(days => days),     days from params
), counted as (
  select w.w, w.days, count(u.id) as signups
  from windows w
  left join auth.users u on u.created_at >= w.lo and u.created_at < w.hi
                          and u.id not in (select user_id from public.test_accounts())   -- people only (migration 039)
  group by w.w, w.days
)
select b.signups                                                            as signups_before,
       a.signups                                                            as signups_after,
       round(b.signups::numeric / b.days, 2)                                as per_day_before,
       round(a.signups::numeric / a.days, 2)                                as per_day_after,
       round(a.signups::numeric / nullif(b.signups, 0), 2)                  as lift_after_over_before
from counted b join counted a on a.w = 'after' where b.w = 'before';

-- Day by day around the send (to see whether the lift is a spike on send day or a level shift).
-- select (u.created_at at time zone 'utc')::date as day, count(*) from auth.users u, (select send_at from (select timestamptz '2026-11-13 17:00:00+00' as send_at) p) p
--  where u.created_at >= p.send_at - interval '14 days' and u.created_at < p.send_at + interval '14 days'
--    and u.id not in (select user_id from public.test_accounts()) group by 1 order by 1;

-- Once links carry utm (signup_attribution exists when ACTIVATION_EVENTS_ENABLED is on): attributed signups per campaign.
-- select utm_campaign, count(*) as signups from signup_attribution where utm_source = 'outreach'
--  and user_id not in (select user_id from public.test_accounts()) group by 1 order by 2 desc;
