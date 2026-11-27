-- Phone calls repair (docs/superpowers/specs/2026-11-26-mm-phone-calls-design.md). Safe to run more than once.
-- Undo: ../rollbacks/032_phone_calls_repair_down.sql
--
-- phone_ledger is the spend control. Every verification call and every phone call reserves its worst-case cost here BEFORE
-- anything is dialled; if the reservation cannot be written there is no call. The limits live in phone_limits() below and
-- nowhere else: changing any of them (the monthly cap included) takes a new migration. No environment variable or table row
-- can raise them. Money is in micro US dollars (1 USD = 1000000). Months are calendar months in UTC.
--
-- Access: server only. RLS on with no policies, nothing granted to anon/authenticated, functions executable by service_role only.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phone_ledger (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind             text NOT NULL CHECK (kind IN ('verify', 'call', 'number_rent', 'agent')),
    funding          text NOT NULL DEFAULT 'company' CHECK (funding IN ('company', 'subscription')),
    user_id          uuid,                       -- no foreign key on purpose: spend must survive an account deletion
    number_hash      text,                       -- keyed hash of the user's own number
    dest_hash        text,                       -- keyed hash of the number dialled
    call_id          uuid UNIQUE,
    month            date NOT NULL,
    reserved_micro   bigint NOT NULL CHECK (reserved_micro >= 0),
    reserved_seconds integer NOT NULL DEFAULT 0 CHECK (reserved_seconds >= 0),
    actual_micro     bigint CHECK (actual_micro >= 0),
    actual_seconds   integer CHECK (actual_seconds >= 0),
    state            text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'settled', 'released')),
    to_number        text,                       -- held only until the call is settled or released
    from_number      text,                       -- same
    call_sid         text,
    claimed_at       timestamptz,
    notice_served_at timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    settled_at       timestamptz
);
CREATE INDEX IF NOT EXISTS phone_ledger_month_idx ON public.phone_ledger (month);
CREATE INDEX IF NOT EXISTS phone_ledger_user_idx ON public.phone_ledger (user_id, created_at);
CREATE INDEX IF NOT EXISTS phone_ledger_number_idx ON public.phone_ledger (number_hash, created_at);
CREATE INDEX IF NOT EXISTS phone_ledger_dest_idx ON public.phone_ledger (dest_hash, created_at);
CREATE INDEX IF NOT EXISTS phone_ledger_open_idx ON public.phone_ledger (created_at) WHERE state = 'reserved';

-- A month in which spending was stopped from outside (the carrier's own usage alarm).
CREATE TABLE IF NOT EXISTS public.phone_halts (
    month      date PRIMARY KEY,
    reason     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_halts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_ledger, public.phone_halts FROM anon, authenticated;

-- Verified numbers: a number counts as verified only when the carrier registered it as an outgoing caller ID.
-- Rows written by the old flow have no twilio_caller_id_sid and are therefore not verified.
ALTER TABLE public.verified_phones ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.verified_phones ADD COLUMN IF NOT EXISTS twilio_caller_id_sid text;
ALTER TABLE public.verified_phones ADD COLUMN IF NOT EXISTS validation_call_sid text;
ALTER TABLE public.verified_phones ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE public.verified_phones ADD COLUMN IF NOT EXISTS ledger_id bigint;
ALTER TABLE public.verified_phones DROP CONSTRAINT IF EXISTS verified_phones_status_check;
ALTER TABLE public.verified_phones ADD CONSTRAINT verified_phones_status_check CHECK (status IN ('pending', 'verified', 'failed'));
-- One owner per verified number.
CREATE UNIQUE INDEX IF NOT EXISTS verified_phones_one_owner_idx ON public.verified_phones (phone_number)
    WHERE status = 'verified';

ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS twilio_account text;   -- 'phone' = the calls subaccount
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS output_language text;
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS call_language text;
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS consent_version text;
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS recording_stored_at timestamptz;   -- audio saved as a recording
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS recording_deleted_at timestamptz;  -- carrier copy deleted
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS transcript_result text;            -- 'completed' or 'failed', once reported

-- Server-owned, like the tables in migration 031.
REVOKE ALL ON TABLE public.phone_calls FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.phone_calls FROM authenticated;

-- Phone funnel events go into the existing events table under one new name, written by the server only.
ALTER TABLE public.activation_events DROP CONSTRAINT IF EXISTS activation_events_name_check;
ALTER TABLE public.activation_events ADD CONSTRAINT activation_events_name_check CHECK (name IN (
    'landed', 'signup_started', 'signup_done', 'record_clicked', 'first_recording_started', 'first_recording_done',
    'summary_viewed', 'sample_viewed', 'upload_chosen', 'phone_step'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Limits (the only place they are defined)
-- ---------------------------------------------------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.phone_month(p_at timestamptz DEFAULT now()) RETURNS date LANGUAGE sql STABLE AS $$
    SELECT date_trunc('month', p_at AT TIME ZONE 'UTC')::date;
$$;

-- Company money committed in a month: settled rows at their real cost, open rows at their full reservation.
CREATE OR REPLACE FUNCTION public.phone_month_spent(p_month date) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE state WHEN 'released' THEN 0 WHEN 'settled' THEN COALESCE(actual_micro, reserved_micro) ELSE reserved_micro END), 0)::bigint
    FROM public.phone_ledger WHERE month = p_month AND funding = 'company';
$$;

-- Free minutes a user (or the own number, across accounts) has used in a month. Every answered call counts in started minutes.
CREATE OR REPLACE FUNCTION public.phone_minutes_used(p_user uuid, p_number_hash text, p_month date) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE state
               WHEN 'released' THEN 0
               WHEN 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0)
               ELSE CEIL(reserved_seconds / 60.0) END), 0)::integer
    FROM public.phone_ledger
    WHERE month = p_month AND kind = 'call' AND funding = 'company'
      AND (user_id = p_user OR (p_number_hash IS NOT NULL AND number_hash = p_number_hash));
$$;

CREATE OR REPLACE FUNCTION public.phone_release_stale() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    UPDATE public.phone_ledger
       SET state = 'released', to_number = NULL, from_number = NULL, settled_at = now()
     WHERE kind = 'call' AND state = 'reserved' AND claimed_at IS NULL
       AND created_at < now() - make_interval(secs => (public.phone_limits()->>'release_seconds')::int);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Verification calls
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phone_reserve_verification(p_user uuid, p_number_hash text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    l jsonb := public.phone_limits();
    m date := public.phone_month();
    cost bigint := (l->>'verify_micro')::bigint;
    month_verify bigint;
    new_id bigint;
BEGIN
    IF p_user IS NULL OR COALESCE(p_number_hash, '') = '' THEN RAISE EXCEPTION 'phone_reserve_verification: missing argument'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));

    IF EXISTS (SELECT 1 FROM public.phone_halts WHERE month = m) THEN RETURN jsonb_build_object('ok', false, 'reason', 'budget_used'); END IF;
    IF EXISTS (SELECT 1 FROM public.phone_ledger WHERE kind = 'verify' AND user_id = p_user
               AND created_at > now() - make_interval(secs => (l->>'verify_gap_seconds')::int)) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'too_soon');
    END IF;
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'verify' AND user_id = p_user AND created_at > now() - interval '24 hours') >= (l->>'verify_user_day')::int
       OR (SELECT count(*) FROM public.phone_ledger WHERE kind = 'verify' AND user_id = p_user AND created_at > now() - interval '30 days') >= (l->>'verify_user_30d')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_limit');
    END IF;
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'verify' AND number_hash = p_number_hash AND created_at > now() - interval '24 hours') >= (l->>'verify_number_day')::int
       OR (SELECT count(*) FROM public.phone_ledger WHERE kind = 'verify' AND number_hash = p_number_hash AND created_at > now() - interval '30 days') >= (l->>'verify_number_30d')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'number_limit');
    END IF;
    -- One attempt per number at a time, so one person's pending request can never be completed by another's call.
    IF EXISTS (SELECT 1 FROM public.phone_ledger WHERE kind = 'verify' AND number_hash = p_number_hash AND user_id IS DISTINCT FROM p_user
               AND state <> 'released' AND created_at > now() - interval '10 minutes') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'number_busy');
    END IF;
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'verify' AND created_at > now() - interval '24 hours') >= (l->>'verify_all_day')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'service_limit');
    END IF;
    SELECT COALESCE(SUM(CASE state WHEN 'released' THEN 0 ELSE COALESCE(actual_micro, reserved_micro) END), 0) INTO month_verify
      FROM public.phone_ledger WHERE month = m AND kind = 'verify' AND funding = 'company';
    IF month_verify + cost > (l->>'verify_month_micro')::bigint OR public.phone_month_spent(m) + cost > (l->>'cap_micro')::bigint THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'budget_used');
    END IF;

    -- The carrier gives no per-verification price, so the full conservative amount is booked at once.
    INSERT INTO public.phone_ledger (kind, user_id, number_hash, month, reserved_micro, actual_micro, state, settled_at)
    VALUES ('verify', p_user, p_number_hash, m, cost, cost, 'settled', now()) RETURNING id INTO new_id;
    RETURN jsonb_build_object('ok', true, 'ledger_id', new_id);
END $$;

-- The carrier refused to place the verification call: nothing was spent. The attempt still counts against the rate limits.
CREATE OR REPLACE FUNCTION public.phone_release_verification(p_ledger_id bigint) RETURNS void LANGUAGE sql AS $$
    UPDATE public.phone_ledger SET state = 'released', actual_micro = 0 WHERE id = p_ledger_id AND kind = 'verify';
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phone_reserve_call(
    p_call uuid, p_user uuid, p_from_hash text, p_dest_hash text, p_from text, p_to text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    l jsonb := public.phone_limits();
    m date := public.phone_month();
    per_min bigint;
    fixed bigint;
    minutes_left integer;
    affordable bigint;
    allowed integer;
    day_ago timestamptz := now() - interval '24 hours';
BEGIN
    IF p_call IS NULL OR p_user IS NULL OR COALESCE(p_from_hash, '') = '' OR COALESCE(p_dest_hash, '') = ''
       OR p_from !~ '^\+1[2-9][0-9]{9}$' OR p_to !~ '^\+1[2-9][0-9]{9}$' THEN
        RAISE EXCEPTION 'phone_reserve_call: bad argument';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    PERFORM public.phone_release_stale();
    -- A reservation this user never connected is dropped (it can no longer be dialled once released).
    UPDATE public.phone_ledger SET state = 'released', to_number = NULL, from_number = NULL, settled_at = now()
     WHERE kind = 'call' AND state = 'reserved' AND claimed_at IS NULL AND user_id = p_user;

    IF EXISTS (SELECT 1 FROM public.phone_halts WHERE month = m) THEN RETURN jsonb_build_object('ok', false, 'reason', 'budget_used'); END IF;
    IF EXISTS (SELECT 1 FROM public.phone_ledger WHERE kind = 'call' AND state = 'reserved' AND (user_id = p_user OR number_hash = p_from_hash)) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'call_in_progress');
    END IF;
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'call' AND state <> 'released' AND (user_id = p_user OR number_hash = p_from_hash)
              AND created_at > now() - interval '1 hour') >= (l->>'calls_user_hour')::int
       OR (SELECT count(*) FROM public.phone_ledger WHERE kind = 'call' AND state <> 'released' AND (user_id = p_user OR number_hash = p_from_hash)
              AND created_at > day_ago) >= (l->>'calls_user_day')::int
       -- Reservations that were never connected cost nothing, but are still bounded.
       OR (SELECT count(*) FROM public.phone_ledger WHERE kind = 'call' AND user_id = p_user AND created_at > now() - interval '1 hour') >= 3 * (l->>'calls_user_hour')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_limit');
    END IF;
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'call' AND state <> 'released' AND dest_hash = p_dest_hash
              AND (user_id = p_user OR number_hash = p_from_hash) AND created_at > day_ago) >= (l->>'calls_dest_user_day')::int
       OR (SELECT count(*) FROM public.phone_ledger WHERE kind = 'call' AND state <> 'released' AND dest_hash = p_dest_hash
              AND created_at > day_ago) >= (l->>'calls_dest_all_day')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'destination_limit');
    END IF;
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'call' AND state <> 'released' AND created_at > day_ago) >= (l->>'calls_all_day')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'service_limit');
    END IF;

    minutes_left := (l->>'user_minutes')::int - public.phone_minutes_used(p_user, p_from_hash, m);
    IF minutes_left <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'user_minutes_used'); END IF;

    -- Worst case of a call of N minutes: N x (carrier + recording + transcription + app leg), plus two more app-leg minutes
    -- (notice, ringing, rounding), one summary and the short-call surcharge.
    per_min := (l->>'pstn_min_micro')::bigint + (l->>'recording_min_micro')::bigint + (l->>'stt_min_micro')::bigint + (l->>'client_min_micro')::bigint;
    fixed := 2 * (l->>'client_min_micro')::bigint + (l->>'summary_micro')::bigint + (l->>'short_call_micro')::bigint;
    affordable := floor(((l->>'cap_micro')::bigint - public.phone_month_spent(m) - fixed)::numeric / per_min);
    allowed := LEAST(minutes_left, affordable, (l->>'max_call_minutes')::int);
    IF allowed IS NULL OR allowed < 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'budget_used'); END IF;

    INSERT INTO public.phone_ledger (kind, user_id, number_hash, dest_hash, call_id, month, reserved_micro, reserved_seconds, to_number, from_number)
    VALUES ('call', p_user, p_from_hash, p_dest_hash, p_call, m, allowed * per_min + fixed, allowed * 60, p_to, p_from);
    RETURN jsonb_build_object('ok', true, 'limit_seconds', allowed * 60, 'minutes_left', minutes_left);
END $$;

-- Single use: the carrier webhook turns a reservation into a dial exactly once, shortly after it was made.
CREATE OR REPLACE FUNCTION public.phone_claim_call(p_call uuid, p_user uuid, p_call_sid text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r public.phone_ledger%ROWTYPE;
BEGIN
    IF COALESCE(p_call_sid, '') = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_call_sid'); END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    IF EXISTS (SELECT 1 FROM public.phone_halts WHERE month = public.phone_month()) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'budget_used');
    END IF;
    UPDATE public.phone_ledger
       SET claimed_at = now(), call_sid = p_call_sid
     WHERE call_id = p_call AND user_id = p_user AND kind = 'call' AND state = 'reserved' AND claimed_at IS NULL
       AND created_at > now() - make_interval(secs => (public.phone_limits()->>'claim_seconds')::int)
    RETURNING * INTO r;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_claimable'); END IF;
    RETURN jsonb_build_object('ok', true, 'to_number', r.to_number, 'from_number', r.from_number, 'limit_seconds', r.reserved_seconds);
END $$;

-- The called person is about to hear the recording notice. A recording of a call without this mark is thrown away.
CREATE OR REPLACE FUNCTION public.phone_notice_served(p_call uuid, p_parent_call_sid text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.phone_ledger SET notice_served_at = COALESCE(notice_served_at, now())
     WHERE call_id = p_call AND call_sid = p_parent_call_sid AND kind = 'call' AND claimed_at IS NOT NULL;
    RETURN FOUND;
END $$;

-- Replaces a reservation with the cost of what really happened: p_app_seconds is the app leg, p_talk_seconds the leg to the
-- called number (0 = not answered). With p_unknown the full reservation is kept (the carrier could not be asked).
CREATE OR REPLACE FUNCTION public.phone_settle_call(p_call uuid, p_app_seconds integer, p_talk_seconds integer, p_unknown boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    l jsonb := public.phone_limits();
    r public.phone_ledger%ROWTYPE;
    app_min bigint;
    talk_min bigint;
    cost bigint;
    seconds integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    SELECT * INTO r FROM public.phone_ledger WHERE call_id = p_call AND kind = 'call' FOR UPDATE;
    IF NOT FOUND OR r.state <> 'reserved' OR r.claimed_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_open'); END IF;
    IF p_unknown THEN
        cost := r.reserved_micro;
        seconds := r.reserved_seconds;
    ELSE
        IF p_app_seconds IS NULL OR p_talk_seconds IS NULL OR p_app_seconds < 0 OR p_talk_seconds < 0 THEN
            RAISE EXCEPTION 'phone_settle_call: bad durations';
        END IF;
        talk_min := CEIL(p_talk_seconds / 60.0);
        app_min := CEIL(p_app_seconds / 60.0);
        cost := talk_min * ((l->>'pstn_min_micro')::bigint + (l->>'recording_min_micro')::bigint + (l->>'stt_min_micro')::bigint)
              + app_min * (l->>'client_min_micro')::bigint
              + CASE WHEN p_talk_seconds > 0 THEN (l->>'summary_micro')::bigint ELSE 0 END
              + CASE WHEN p_talk_seconds <= 6 THEN (l->>'short_call_micro')::bigint ELSE 0 END;
        seconds := p_talk_seconds;
    END IF;
    UPDATE public.phone_ledger
       SET state = 'settled', actual_micro = cost, actual_seconds = seconds, settled_at = now(), to_number = NULL, from_number = NULL
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', true, 'cost_micro', cost, 'talk_seconds', seconds, 'over_reservation', cost > r.reserved_micro);
END $$;

-- The app gave up before connecting: nothing was dialled, so nothing is booked.
CREATE OR REPLACE FUNCTION public.phone_release_call(p_call uuid, p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    UPDATE public.phone_ledger SET state = 'released', to_number = NULL, from_number = NULL, settled_at = now()
     WHERE call_id = p_call AND user_id = p_user AND kind = 'call' AND state = 'reserved' AND claimed_at IS NULL;
    RETURN FOUND;
END $$;

-- What the app may show, and what monitoring reads.
CREATE OR REPLACE FUNCTION public.phone_budget(p_user uuid, p_number_hash text) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'minutes_per_month', (public.phone_limits()->>'user_minutes')::int,
        'minutes_left', GREATEST((public.phone_limits()->>'user_minutes')::int - public.phone_minutes_used(p_user, p_number_hash, public.phone_month()), 0),
        'month_spent_micro', public.phone_month_spent(public.phone_month()),
        'cap_micro', (public.phone_limits()->>'cap_micro')::bigint,
        'halted', EXISTS (SELECT 1 FROM public.phone_halts WHERE month = public.phone_month()));
$$;

CREATE OR REPLACE FUNCTION public.phone_halt(p_reason text) RETURNS void LANGUAGE sql AS $$
    INSERT INTO public.phone_halts (month, reason) VALUES (public.phone_month(), left(p_reason, 80)) ON CONFLICT (month) DO NOTHING;
$$;

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
