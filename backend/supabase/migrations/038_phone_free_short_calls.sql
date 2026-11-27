-- Very short calls use no free minutes. An outgoing call whose talk time is more than 0 and under 15 seconds costs the person nothing,
-- for the first 5 such calls of a calendar month (UTC) in the scope phone_minutes_used() counts: the account, plus the own number
-- across accounts. Later ones count in started minutes, as before. An unanswered call (0 seconds) stays at 0 and is not one of the 5.
-- Both what a new call may use (phone_minutes_used) and what the app shows (phone_minutes_shown) follow this. Money booked against the
-- company cap is unchanged: phone_settle_call() and phone_month_spent() are not touched.
--
-- Incoming forwarded calls count as before and are never free: for them the ledger holds the length of the whole incoming call (notice
-- and ringing included), not the talk time. phone_minutes_shown() of 037 left them out although phone_minutes_used() counts them since
-- 033; it counts them again here.
--
-- Safe to run more than once. Requires 032, 033 and 037; running 032, 033 or 037 again puts older functions back (run this again then).
-- Undo: ../rollbacks/038_phone_free_short_calls_down.sql. Same access rules: server only.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- The limits of 032, unchanged, plus the two numbers of the short-call rule.
CREATE OR REPLACE FUNCTION public.phone_limits() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'cap_micro',               25000000,  -- US$25 of company money per calendar month, everything included
        'user_minutes',            30,        -- free call minutes per user (and per own number) per month
        'free_short_under_seconds', 15,       -- a call with less talk time than this (and more than none) is short
        'free_short_calls',        5,         -- short calls per user (and per own number) per month that use no free minutes
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

-- The ledger rows that use no free minutes: the first short calls of the month, in the order they were started.
-- Only settled outgoing calls: actual_seconds is then the talk time to the called number. A call settled without an answer from the
-- carrier holds its whole reservation there, so it is never short.
CREATE OR REPLACE FUNCTION public.phone_free_short_calls(p_user uuid, p_number_hash text, p_month date) RETURNS SETOF bigint LANGUAGE sql STABLE AS $$
    SELECT id
    FROM public.phone_ledger
    WHERE month = p_month AND kind = 'call' AND funding = 'company' AND state = 'settled'
      AND actual_seconds > 0 AND actual_seconds < (public.phone_limits()->>'free_short_under_seconds')::int
      AND (user_id = p_user OR (p_number_hash IS NOT NULL AND number_hash = p_number_hash))
    ORDER BY created_at, id
    LIMIT (public.phone_limits()->>'free_short_calls')::int;
$$;

-- As in 033, less the free short calls.
CREATE OR REPLACE FUNCTION public.phone_minutes_used(p_user uuid, p_number_hash text, p_month date) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE
               WHEN state = 'released' THEN 0
               WHEN id IN (SELECT public.phone_free_short_calls(p_user, p_number_hash, p_month)) THEN 0
               WHEN state = 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0)
               ELSE CEIL(reserved_seconds / 60.0) END), 0)::integer
    FROM public.phone_ledger
    WHERE month = p_month AND kind IN ('call', 'inbound') AND funding = 'company'
      AND (user_id = p_user OR (p_number_hash IS NOT NULL AND number_hash = p_number_hash));
$$;

-- As in 037, less the free short calls, and with the incoming calls that phone_minutes_used() counts. A call in progress is not yet
-- known to be short: it shows the started minutes it has run until it is settled.
CREATE OR REPLACE FUNCTION public.phone_minutes_shown(p_user uuid, p_number_hash text, p_month date) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE
               WHEN state = 'released' THEN 0
               WHEN id IN (SELECT public.phone_free_short_calls(p_user, p_number_hash, p_month)) THEN 0
               WHEN state = 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0)
               WHEN claimed_at IS NULL THEN 0  -- nothing has been dialled
               ELSE CEIL(LEAST(reserved_seconds, GREATEST(EXTRACT(EPOCH FROM now() - claimed_at), 0)) / 60.0) END), 0)::integer
    FROM public.phone_ledger
    WHERE month = p_month AND kind IN ('call', 'inbound') AND funding = 'company'
      AND (user_id = p_user OR (p_number_hash IS NOT NULL AND number_hash = p_number_hash));
$$;

-- Functions are reachable through the data API unless revoked: server only.
REVOKE ALL ON FUNCTION public.phone_limits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_free_short_calls(uuid, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_minutes_used(uuid, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phone_minutes_shown(uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phone_limits() TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_free_short_calls(uuid, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_minutes_used(uuid, text, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.phone_minutes_shown(uuid, text, date) TO service_role;

COMMIT;
