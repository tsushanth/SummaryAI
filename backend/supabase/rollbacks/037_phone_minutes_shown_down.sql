-- Undo of 037_phone_minutes_shown.sql: phone_budget() as migration 032 defines it.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phone_budget(p_user uuid, p_number_hash text) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'minutes_per_month', (public.phone_limits()->>'user_minutes')::int,
        'minutes_left', GREATEST((public.phone_limits()->>'user_minutes')::int - public.phone_minutes_used(p_user, p_number_hash, public.phone_month()), 0),
        'month_spent_micro', public.phone_month_spent(public.phone_month()),
        'cap_micro', (public.phone_limits()->>'cap_micro')::bigint,
        'halted', EXISTS (SELECT 1 FROM public.phone_halts WHERE month = public.phone_month()));
$$;

DROP FUNCTION IF EXISTS public.phone_minutes_shown(uuid, text, date);

COMMIT;
