-- Undo of 038_phone_free_short_calls.sql: phone_limits() as migration 032 defines it, phone_minutes_used() as 033 and
-- phone_minutes_shown() as 037. Run this before the rollback of 037, 033 or 032. No data is touched.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phone_limits() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'cap_micro',               25000000,  -- US$25 of company money per calendar month, everything included
        'user_minutes',            30,        -- free call minutes per user (and per own number) per month
        'max_call_minutes',        30,
        -- Booking rates per started minute, deliberately high
        'client_min_micro',        5000,      -- app leg
        'pstn_min_micro',          15000,     -- US/Canada leg
        'recording_min_micro',     3000,      -- recording, storage
        'stt_min_micro',           10000,     -- transcription
        'summary_micro',           30000,     -- summary, per call with a conversation
        'short_call_micro',        15000,     -- unanswered or very short calls
        'verify_micro',            50000,     -- one verification call
        'verify_month_micro',      3000000,   -- share of the cap that verification calls may use
        'verify_user_day',         3,
        'verify_user_30d',         6,
        'verify_number_day',       3,
        'verify_number_30d',       5,
        'verify_all_day',          20,
        'verify_gap_seconds',      60,
        'calls_user_hour',         6,
        'calls_user_day',          15,
        'calls_dest_user_day',     4,
        'calls_dest_all_day',      6,
        'calls_all_day',           100,
        'claim_seconds',           120,       -- the app must connect within this time of the reservation
        'release_seconds',         180        -- unclaimed reservations are released after this
    );
$$;

CREATE OR REPLACE FUNCTION public.phone_minutes_used(p_user uuid, p_number_hash text, p_month date) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE state
               WHEN 'released' THEN 0
               WHEN 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0)
               ELSE CEIL(reserved_seconds / 60.0) END), 0)::integer
    FROM public.phone_ledger
    WHERE month = p_month AND kind IN ('call', 'inbound') AND funding = 'company'
      AND (user_id = p_user OR (p_number_hash IS NOT NULL AND number_hash = p_number_hash));
$$;

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

DROP FUNCTION IF EXISTS public.phone_free_short_calls(uuid, text, date);

COMMIT;
