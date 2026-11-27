-- The minutes the app shows. A call in progress counted as everything reserved for it, which is all the minutes the person has left, so
-- the app showed none left and said "You have used your free call minutes" during and just after a call. Shown from now on: finished
-- calls at their started minutes, plus the started minutes a connected call has run so far. What a new call may use is unchanged:
-- phone_minutes_used() still counts the whole reservation, and one call at a time is still enforced.
-- Safe to run more than once. Requires 032; running 032 again puts the old phone_budget() back. Undo: ../rollbacks/037_phone_minutes_shown_down.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phone_minutes_shown(p_user uuid, p_number_hash text, p_month date) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE
               WHEN state = 'released' THEN 0
               WHEN state = 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0)
               WHEN claimed_at IS NULL THEN 0  -- nothing has been dialled
               ELSE CEIL(LEAST(reserved_seconds, GREATEST(EXTRACT(EPOCH FROM now() - claimed_at), 0)) / 60.0) END), 0)::integer
    FROM public.phone_ledger
    WHERE month = p_month AND kind = 'call' AND funding = 'company'
      AND (user_id = p_user OR (p_number_hash IS NOT NULL AND number_hash = p_number_hash));
$$;
REVOKE ALL ON FUNCTION public.phone_minutes_shown(uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_minutes_shown(uuid, text, date) TO service_role;

CREATE OR REPLACE FUNCTION public.phone_budget(p_user uuid, p_number_hash text) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'minutes_per_month', (public.phone_limits()->>'user_minutes')::int,
        'minutes_left', GREATEST((public.phone_limits()->>'user_minutes')::int - public.phone_minutes_shown(p_user, p_number_hash, public.phone_month()), 0),
        'month_spent_micro', public.phone_month_spent(public.phone_month()),
        'cap_micro', (public.phone_limits()->>'cap_micro')::bigint,
        'halted', EXISTS (SELECT 1 FROM public.phone_halts WHERE month = public.phone_month()));
$$;

COMMIT;
