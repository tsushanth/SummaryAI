-- Phone usage counts include only people who could see phone calls, split by their country. Safe to run more than once.
-- Undo: ../rollbacks/035_phone_audience_counts_down.sql. Requires 032 and 034. Same access rules: server only.
-- Roll this back before ever re-applying 032 or 034 (they define the two count functions with the old columns).
--
-- The server writes the step 'feature_seen' (with the country that showed the feature, never a number) when it shows
-- phone calls to an account. Accounts without that step, and test accounts or test devices, are left out of both counts.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Everyone who could see the feature, with the country they were last shown it under.
CREATE OR REPLACE FUNCTION public.phone_audience() RETURNS TABLE (user_id uuid, country text) LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (a.user_id) a.user_id, COALESCE(a.props->>'country', 'unknown')
      FROM public.activation_events a
     WHERE a.name = 'phone_step' AND a.user_id IS NOT NULL AND a.props->>'step' = 'feature_seen'
       AND a.user_id NOT IN (SELECT t.user_id FROM public.activation_events t
                              WHERE t.name = 'phone_step' AND t.user_id IS NOT NULL AND t.props->>'test' = 'true')
     ORDER BY a.user_id, a.created_at DESC
$$;

-- Counts of every phone step per country. Counts only. For 'feature_seen' the reason is why it was shown.
DROP FUNCTION IF EXISTS public.phone_step_counts(timestamptz);
CREATE FUNCTION public.phone_step_counts(p_since timestamptz) RETURNS TABLE (step text, country text, reason text, users bigint, events bigint)
LANGUAGE sql STABLE AS $$
    SELECT a.props->>'step', v.country, COALESCE(a.props->>'reason', a.props->>'cap', a.props->>'via', ''),
           count(DISTINCT a.user_id), count(*)
      FROM public.activation_events a JOIN public.phone_audience() v ON v.user_id = a.user_id
     WHERE a.name = 'phone_step' AND a.created_at >= p_since
     GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
$$;

-- Demand funnel. Segment = the person's latest answer to "Is this for a business?"; could_see = people in the row.
DROP FUNCTION IF EXISTS public.phone_funnel(timestamptz);
CREATE FUNCTION public.phone_funnel(p_since timestamptz) RETURNS TABLE (
    segment text, country text, could_see bigint, tab_opened bigint, number_requested bigint, verified bigint, called bigint,
    connected bigint, repeat_weeks bigint, week2_eligible bigint, week2_repeat bigint, agent_created bigint,
    purchase_started bigint, purchase_completed bigint, cap_hit bigint) LANGUAGE sql STABLE AS $$
WITH e AS (
    SELECT a.user_id, a.created_at, a.props->>'step' AS step, a.props->>'answer' AS answer, v.country
      FROM public.activation_events a JOIN public.phone_audience() v ON v.user_id = a.user_id
     WHERE a.name = 'phone_step'
),
who AS (
    SELECT user_id, country,
        COALESCE((SELECT x.answer FROM e x WHERE x.user_id = u.user_id AND x.step = 'business_answer' ORDER BY x.created_at DESC LIMIT 1), 'not_asked') AS segment,
        min(created_at) FILTER (WHERE step = 'call_connected') AS first_call
      FROM e u GROUP BY user_id, country
),
per AS (
    SELECT w.user_id, w.segment, w.country,
        bool_or(e.step = 'tab_opened') AS tab_opened,
        bool_or(e.step IN ('number_requested', 'verify_started')) AS number_requested,
        bool_or(e.step = 'verify_ok') AS verified,
        bool_or(e.step = 'call_started') AS called,
        bool_or(e.step = 'call_connected') AS connected,
        count(DISTINCT date_trunc('week', e.created_at)) FILTER (WHERE e.step = 'call_connected') >= 2 AS repeat_weeks,
        -- week 2 = days 8 to 14 after the first answered call; counted only once that window is over
        w.first_call IS NOT NULL AND w.first_call <= now() - interval '14 days' AS week2_eligible,
        w.first_call IS NOT NULL AND w.first_call <= now() - interval '14 days'
          AND bool_or(e.step = 'call_connected' AND e.created_at >= w.first_call + interval '7 days'
                      AND e.created_at < w.first_call + interval '14 days') AS week2_repeat,
        bool_or(e.step = 'agent_created') AS agent_created,
        bool_or(e.step = 'purchase_started') AS purchase_started,
        bool_or(e.step = 'purchase_completed') AS purchase_completed,
        bool_or(e.step = 'cap_hit') AS cap_hit
      FROM who w JOIN e ON e.user_id = w.user_id AND e.created_at >= p_since
     GROUP BY w.user_id, w.segment, w.country, w.first_call
)
SELECT segment, country, count(*),
    count(*) FILTER (WHERE tab_opened), count(*) FILTER (WHERE number_requested), count(*) FILTER (WHERE verified),
    count(*) FILTER (WHERE called), count(*) FILTER (WHERE connected), count(*) FILTER (WHERE repeat_weeks),
    count(*) FILTER (WHERE week2_eligible), count(*) FILTER (WHERE week2_repeat), count(*) FILTER (WHERE agent_created),
    count(*) FILTER (WHERE purchase_started), count(*) FILTER (WHERE purchase_completed), count(*) FILTER (WHERE cap_hit)
  FROM per GROUP BY segment, country ORDER BY segment, country;
$$;

-- Functions are reachable through the data API unless revoked: server only.
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname LIKE 'phone\_%' ESCAPE '\'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END LOOP;
END $$;

COMMIT;
