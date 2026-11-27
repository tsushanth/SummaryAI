-- Undo of 035_phone_audience_counts.sql: the two count functions as 032 and 034 defined them. No data is touched.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.phone_funnel(timestamptz);
DROP FUNCTION IF EXISTS public.phone_step_counts(timestamptz);
DROP FUNCTION IF EXISTS public.phone_audience();

-- Demand funnel (events only, test accounts and test devices left out). Segment = the user's latest answer to
-- "Is this for a business?"; country = latest country seen on the user's events.
CREATE OR REPLACE FUNCTION public.phone_funnel(p_since timestamptz) RETURNS TABLE (
    segment text, country text, tab_opened bigint, number_requested bigint, verified bigint, called bigint, connected bigint,
    repeat_weeks bigint, week2_eligible bigint, week2_repeat bigint, agent_created bigint, purchase_started bigint,
    purchase_completed bigint, cap_hit bigint) LANGUAGE sql STABLE AS $$
WITH e AS (
    SELECT user_id, created_at, props->>'step' AS step, props->>'answer' AS answer, props->>'country' AS country
      FROM public.activation_events
     WHERE name = 'phone_step' AND user_id IS NOT NULL
       AND user_id NOT IN (SELECT user_id FROM public.activation_events
                            WHERE name = 'phone_step' AND user_id IS NOT NULL AND props->>'test' = 'true')
),
who AS (
    SELECT user_id,
        COALESCE((SELECT x.answer FROM e x WHERE x.user_id = u.user_id AND x.step = 'business_answer' ORDER BY x.created_at DESC LIMIT 1), 'not_asked') AS segment,
        COALESCE((SELECT x.country FROM e x WHERE x.user_id = u.user_id AND x.country IS NOT NULL
                   ORDER BY (x.step IN ('verify_started', 'verify_ok')) DESC, x.created_at DESC LIMIT 1), 'unknown') AS country,
        min(created_at) FILTER (WHERE step = 'call_connected') AS first_call
      FROM e u GROUP BY user_id
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
SELECT segment, country,
    count(*) FILTER (WHERE tab_opened), count(*) FILTER (WHERE number_requested), count(*) FILTER (WHERE verified),
    count(*) FILTER (WHERE called), count(*) FILTER (WHERE connected), count(*) FILTER (WHERE repeat_weeks),
    count(*) FILTER (WHERE week2_eligible), count(*) FILTER (WHERE week2_repeat), count(*) FILTER (WHERE agent_created),
    count(*) FILTER (WHERE purchase_started), count(*) FILTER (WHERE purchase_completed), count(*) FILTER (WHERE cap_hit)
  FROM per GROUP BY segment, country ORDER BY segment, country;
$$;

-- Counts of every phone step, test accounts and test devices left out. Counts only.
CREATE OR REPLACE FUNCTION public.phone_step_counts(p_since timestamptz) RETURNS TABLE (step text, reason text, users bigint, events bigint)
LANGUAGE sql STABLE AS $$
    SELECT props->>'step', COALESCE(props->>'reason', props->>'cap', ''), count(DISTINCT user_id), count(*)
      FROM public.activation_events
     WHERE name = 'phone_step' AND created_at >= p_since AND user_id IS NOT NULL
       AND user_id NOT IN (SELECT user_id FROM public.activation_events
                            WHERE name = 'phone_step' AND user_id IS NOT NULL AND props->>'test' = 'true')
     GROUP BY 1, 2 ORDER BY 1, 2;
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
