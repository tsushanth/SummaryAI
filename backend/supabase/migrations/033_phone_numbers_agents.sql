-- Phone phases 2 and 3: pool and personal numbers, a Google Play subscription for a personal number, incoming calls,
-- agents on personal numbers. Safe to run more than once. Undo: ../rollbacks/033_phone_numbers_agents_down.sql
-- Requires 032. Same access rules: server only.
--
-- Money: funding 'company' counts against the monthly cap of phone_limits(). Funding 'subscription' is paid by that
-- user's subscription, never counts against the company cap, and stops when the included time of the period is used.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.phone_numbers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number  text UNIQUE,                       -- null only while it is being bought
    country       text NOT NULL CHECK (country IN ('US', 'CA')),
    kind          text NOT NULL CHECK (kind IN ('pool', 'personal')),
    provider_sid  text,
    user_id       uuid,                              -- personal numbers only
    status        text NOT NULL DEFAULT 'buying' CHECK (status IN ('buying', 'active', 'released')),
    agent_id      text,
    agent_language text,
    agent_description text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    released_at   timestamptz,
    CHECK (kind = 'personal' OR user_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS phone_numbers_one_personal_idx ON public.phone_numbers (user_id)
    WHERE kind = 'personal' AND status <> 'released';

-- Return calls to a shared number: the pair (our number, caller) belongs to at most one user at a time.
CREATE TABLE IF NOT EXISTS public.phone_return_routes (
    number_id   uuid NOT NULL REFERENCES public.phone_numbers(id) ON DELETE CASCADE,
    remote_hash text NOT NULL,
    user_id     uuid NOT NULL,
    phone_id    uuid NOT NULL REFERENCES public.verified_phones(id) ON DELETE CASCADE,
    expires_at  timestamptz NOT NULL,
    PRIMARY KEY (number_id, remote_hash)
);

CREATE TABLE IF NOT EXISTS public.phone_subscriptions (
    user_id        uuid PRIMARY KEY,
    product_id     text NOT NULL,
    token_hash     text NOT NULL UNIQUE,
    purchase_token text NOT NULL,                    -- needed to ask Google again
    state          text NOT NULL,
    period_start   timestamptz NOT NULL,
    expires_at     timestamptz NOT NULL,
    call_seconds   integer NOT NULL CHECK (call_seconds BETWEEN 0 AND 18000),   -- hard ceiling: 300 minutes
    agent_seconds  integer NOT NULL CHECK (agent_seconds BETWEEN 0 AND 5400),   -- hard ceiling: 90 minutes
    checked_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_return_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_numbers, public.phone_return_routes, public.phone_subscriptions FROM anon, authenticated;

ALTER TABLE public.phone_ledger ADD COLUMN IF NOT EXISTS number_id uuid;
ALTER TABLE public.phone_ledger DROP CONSTRAINT IF EXISTS phone_ledger_kind_check;
ALTER TABLE public.phone_ledger ADD CONSTRAINT phone_ledger_kind_check CHECK (kind IN ('verify', 'call', 'inbound', 'number_rent', 'agent'));
CREATE UNIQUE INDEX IF NOT EXISTS phone_ledger_rent_once_idx ON public.phone_ledger (number_id, month) WHERE kind = 'number_rent' AND state <> 'released';

ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS direction text;        -- 'out' (or null) and 'in'
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS agent_id text;
ALTER TABLE public.phone_calls ADD COLUMN IF NOT EXISTS agent_result jsonb;    -- transcript, summary, outcome from the agent

CREATE OR REPLACE FUNCTION public.phone_limits2() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'rent_micro',               1500000,  -- one US or Canada number for a month, booked high
        'inbound_min_micro',        40000,    -- incoming leg, forwarding leg, recording, transcription
        'agent_min_micro',          150000,   -- incoming leg and the agent
        'agent_draft_micro',        150000,   -- creating or changing an agent
        'free_agent_minutes',       10,       -- company-paid agent minutes per tester per month
        'max_agent_seconds',        600,
        'drafts_user_day',          5,
        'route_days',               30,
        'max_pool_numbers',         4
    );
$$;

-- Free minutes now include forwarded incoming calls on shared numbers.
CREATE OR REPLACE FUNCTION public.phone_minutes_used(p_user uuid, p_number_hash text, p_month date) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE state
               WHEN 'released' THEN 0
               WHEN 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0)
               ELSE CEIL(reserved_seconds / 60.0) END), 0)::integer
    FROM public.phone_ledger
    WHERE month = p_month AND kind IN ('call', 'inbound') AND funding = 'company'
      AND (user_id = p_user OR (p_number_hash IS NOT NULL AND number_hash = p_number_hash));
$$;

CREATE OR REPLACE FUNCTION public.phone_notice_served(p_call uuid, p_parent_call_sid text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    UPDATE public.phone_ledger SET notice_served_at = COALESCE(notice_served_at, now())
     WHERE call_id = p_call AND call_sid = p_parent_call_sid AND kind IN ('call', 'inbound', 'agent') AND claimed_at IS NOT NULL;
    RETURN FOUND;
END $$;

-- Books the month's rent of a number once. With p_require_room (a purchase) it refuses when the company cap has no room;
-- a renewal that already happened is booked anyway and reported as over the cap.
CREATE OR REPLACE FUNCTION public.phone_book_rent(p_number uuid, p_require_room boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    m date := public.phone_month();
    cost bigint := (public.phone_limits2()->>'rent_micro')::bigint;
    n public.phone_numbers%ROWTYPE;
    fund text;
    over boolean;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    SELECT * INTO n FROM public.phone_numbers WHERE id = p_number AND status <> 'released';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_number'); END IF;
    IF EXISTS (SELECT 1 FROM public.phone_ledger WHERE kind = 'number_rent' AND number_id = p_number AND month = m AND state <> 'released') THEN
        RETURN jsonb_build_object('ok', true, 'already', true);
    END IF;
    fund := CASE WHEN n.kind = 'personal' AND EXISTS (SELECT 1 FROM public.phone_subscriptions s WHERE s.user_id = n.user_id AND s.expires_at > now())
                 THEN 'subscription' ELSE 'company' END;
    over := fund = 'company' AND public.phone_month_spent(m) + cost > (public.phone_limits()->>'cap_micro')::bigint;
    IF p_require_room AND (over OR (fund = 'company' AND EXISTS (SELECT 1 FROM public.phone_halts WHERE month = m))) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'budget_used');
    END IF;
    IF p_require_room AND n.kind = 'pool' AND (SELECT count(*) FROM public.phone_numbers WHERE kind = 'pool' AND status <> 'released') > (public.phone_limits2()->>'max_pool_numbers')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'pool_full');
    END IF;
    INSERT INTO public.phone_ledger (kind, funding, user_id, number_id, month, reserved_micro, actual_micro, state, settled_at)
    VALUES ('number_rent', fund, n.user_id, p_number, m, cost, cost, 'settled', now());
    RETURN jsonb_build_object('ok', true, 'funding', fund, 'over_cap', over);
END $$;

CREATE OR REPLACE FUNCTION public.phone_release_rent(p_number uuid) RETURNS void LANGUAGE sql AS $$
    UPDATE public.phone_ledger SET state = 'released', actual_micro = 0 WHERE kind = 'number_rent' AND number_id = p_number AND month = public.phone_month();
$$;

-- Picks the shared number a user shows to one person, so that this person's return call reaches this user and nobody else.
CREATE OR REPLACE FUNCTION public.phone_assign_route(p_user uuid, p_phone uuid, p_remote_hash text, p_country text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE chosen public.phone_numbers%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_return_routes'));
    IF NOT EXISTS (SELECT 1 FROM public.verified_phones WHERE id = p_phone AND user_id = p_user AND status = 'verified') THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_verified');
    END IF;
    DELETE FROM public.phone_return_routes WHERE expires_at < now();
    SELECT n.* INTO chosen FROM public.phone_numbers n
      LEFT JOIN public.phone_return_routes r ON r.number_id = n.id AND r.remote_hash = p_remote_hash
     WHERE n.kind = 'pool' AND n.status = 'active' AND (r.user_id IS NULL OR r.user_id = p_user)
     ORDER BY (r.user_id = p_user) DESC NULLS LAST, (n.country = p_country) DESC, n.created_at
     LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_shared_number'); END IF;
    INSERT INTO public.phone_return_routes (number_id, remote_hash, user_id, phone_id, expires_at)
    VALUES (chosen.id, p_remote_hash, p_user, p_phone, now() + make_interval(days => (public.phone_limits2()->>'route_days')::int))
    ON CONFLICT (number_id, remote_hash) DO UPDATE SET phone_id = EXCLUDED.phone_id, expires_at = EXCLUDED.expires_at
        WHERE public.phone_return_routes.user_id = EXCLUDED.user_id;
    RETURN jsonb_build_object('ok', true, 'number_id', chosen.id, 'phone_number', chosen.phone_number);
END $$;

-- Seconds of the current subscription period still unused, for 'call' (calls both ways) or 'agent'.
CREATE OR REPLACE FUNCTION public.phone_sub_left(p_user uuid, p_what text) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE((
        SELECT GREATEST((CASE WHEN p_what = 'agent' THEN s.agent_seconds ELSE s.call_seconds END) - COALESCE((
            SELECT SUM(CASE l.state WHEN 'released' THEN 0
                                    WHEN 'settled' THEN CEIL(COALESCE(l.actual_seconds, l.reserved_seconds) / 60.0) * 60
                                    ELSE l.reserved_seconds END)
              FROM public.phone_ledger l
             WHERE l.user_id = s.user_id AND l.funding = 'subscription' AND l.created_at >= s.period_start
               AND l.kind = ANY (CASE WHEN p_what = 'agent' THEN ARRAY['agent'] ELSE ARRAY['call', 'inbound'] END)), 0), 0)::integer
          FROM public.phone_subscriptions s
         WHERE s.user_id = p_user AND s.expires_at > now()
           AND s.state IN ('SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED')), 0);
$$;

-- Reserves a leg that is not a free outgoing call:
--   'call'    outgoing call showing the user's personal number (subscription)
--   'inbound' incoming call forwarded to the user's phone (subscription on a personal number, company on a shared one)
--   'agent'   incoming call answered by the user's agent (subscription; p_company for testers)
-- 'inbound' and 'agent' are claimed at once: the carrier call already exists (p_call_sid).
CREATE OR REPLACE FUNCTION public.phone_reserve_leg(
    p_kind text, p_call uuid, p_user uuid, p_number_id uuid, p_user_hash text, p_remote_hash text,
    p_from text, p_to text, p_call_sid text, p_company boolean) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    l jsonb := public.phone_limits();
    l2 jsonb := public.phone_limits2();
    m date := public.phone_month();
    fund text := CASE WHEN p_company THEN 'company' ELSE 'subscription' END;
    per_min bigint;
    fixed bigint := (public.phone_limits()->>'summary_micro')::bigint;
    left_seconds integer;
    affordable bigint;
    allowed integer;
BEGIN
    IF p_kind NOT IN ('call', 'inbound', 'agent') OR p_call IS NULL OR p_user IS NULL THEN RAISE EXCEPTION 'phone_reserve_leg: bad argument'; END IF;
    IF p_kind = 'call' AND p_company THEN RAISE EXCEPTION 'phone_reserve_leg: free outgoing calls use phone_reserve_call'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    PERFORM public.phone_release_stale();
    IF EXISTS (SELECT 1 FROM public.phone_halts WHERE month = m) THEN RETURN jsonb_build_object('ok', false, 'reason', 'budget_used'); END IF;
    IF p_call_sid IS NOT NULL AND EXISTS (SELECT 1 FROM public.phone_ledger WHERE call_sid = p_call_sid) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'duplicate');
    END IF;
    IF EXISTS (SELECT 1 FROM public.phone_ledger WHERE state = 'reserved' AND kind IN ('call', 'inbound', 'agent') AND user_id = p_user) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'call_in_progress');
    END IF;
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind IN ('call', 'inbound', 'agent') AND state <> 'released' AND user_id = p_user
          AND created_at > now() - interval '1 hour') >= 3 * (l->>'calls_user_hour')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_limit');
    END IF;

    per_min := CASE p_kind WHEN 'agent' THEN (l2->>'agent_min_micro')::bigint ELSE (l2->>'inbound_min_micro')::bigint END;
    IF fund = 'subscription' THEN
        left_seconds := public.phone_sub_left(p_user, CASE WHEN p_kind = 'agent' THEN 'agent' ELSE 'call' END);
        allowed := LEAST(floor(left_seconds / 60.0)::int,
                         CASE WHEN p_kind = 'agent' THEN (l2->>'max_agent_seconds')::int / 60 ELSE (l->>'max_call_minutes')::int END);
        IF allowed < 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'included_used'); END IF;
    ELSE
        IF p_kind = 'agent' THEN
            left_seconds := 60 * (l2->>'free_agent_minutes')::int - COALESCE((SELECT SUM(CASE state WHEN 'released' THEN 0
                    WHEN 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0) * 60 ELSE reserved_seconds END)
                FROM public.phone_ledger WHERE month = m AND kind = 'agent' AND funding = 'company' AND user_id = p_user AND call_id IS NOT NULL), 0);
        ELSE
            left_seconds := 60 * ((l->>'user_minutes')::int - public.phone_minutes_used(p_user, p_user_hash, m));
        END IF;
        affordable := floor(((l->>'cap_micro')::bigint - public.phone_month_spent(m) - fixed)::numeric / per_min);
        allowed := LEAST(floor(left_seconds / 60.0)::bigint, affordable,
                         CASE WHEN p_kind = 'agent' THEN (l2->>'max_agent_seconds')::int / 60 ELSE (l->>'max_call_minutes')::int END);
        IF floor(left_seconds / 60.0) < 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'user_minutes_used'); END IF;
        IF allowed IS NULL OR allowed < 1 THEN RETURN jsonb_build_object('ok', false, 'reason', 'budget_used'); END IF;
    END IF;

    INSERT INTO public.phone_ledger (kind, funding, user_id, number_id, number_hash, dest_hash, call_id, month, reserved_micro,
                                     reserved_seconds, to_number, from_number, call_sid, claimed_at)
    VALUES (p_kind, fund, p_user, p_number_id, p_user_hash, p_remote_hash, p_call, m, allowed * per_min + fixed, allowed * 60,
            p_to, p_from, p_call_sid, CASE WHEN p_call_sid IS NULL THEN NULL ELSE now() END);
    RETURN jsonb_build_object('ok', true, 'limit_seconds', allowed * 60, 'funding', fund);
END $$;

-- The app's webhook claims outgoing calls of either funding.
-- (phone_claim_call and phone_settle_call of 032 already select by kind = 'call'.)

-- Settles an incoming or agent leg from the length of the carrier call.
CREATE OR REPLACE FUNCTION public.phone_settle_leg(p_call uuid, p_seconds integer, p_unknown boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    l2 jsonb := public.phone_limits2();
    r public.phone_ledger%ROWTYPE;
    cost bigint;
    seconds integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    SELECT * INTO r FROM public.phone_ledger WHERE call_id = p_call AND kind IN ('inbound', 'agent') FOR UPDATE;
    IF NOT FOUND OR r.state <> 'reserved' THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_open'); END IF;
    IF p_unknown THEN
        cost := r.reserved_micro; seconds := r.reserved_seconds;
    ELSE
        IF p_seconds IS NULL OR p_seconds < 0 THEN RAISE EXCEPTION 'phone_settle_leg: bad duration'; END IF;
        cost := CEIL(p_seconds / 60.0) * (CASE r.kind WHEN 'agent' THEN (l2->>'agent_min_micro')::bigint ELSE (l2->>'inbound_min_micro')::bigint END)
              + CASE WHEN p_seconds > 0 THEN (public.phone_limits()->>'summary_micro')::bigint ELSE 0 END;
        seconds := p_seconds;
    END IF;
    UPDATE public.phone_ledger SET state = 'settled', actual_micro = cost, actual_seconds = seconds, settled_at = now(),
           to_number = NULL, from_number = NULL WHERE id = r.id;
    RETURN jsonb_build_object('ok', true, 'cost_micro', cost, 'talk_seconds', seconds, 'over_reservation', cost > r.reserved_micro);
END $$;

-- Creating or changing an agent costs money: booked first, limited per day, within the company cap.
CREATE OR REPLACE FUNCTION public.phone_reserve_draft(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    m date := public.phone_month();
    cost bigint := (public.phone_limits2()->>'agent_draft_micro')::bigint;
    new_id bigint;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'agent' AND call_id IS NULL AND user_id = p_user
          AND created_at > now() - interval '24 hours') >= (public.phone_limits2()->>'drafts_user_day')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_limit');
    END IF;
    IF EXISTS (SELECT 1 FROM public.phone_halts WHERE month = m)
       OR public.phone_month_spent(m) + cost > (public.phone_limits()->>'cap_micro')::bigint THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'budget_used');
    END IF;
    INSERT INTO public.phone_ledger (kind, user_id, month, reserved_micro, actual_micro, state, settled_at)
    VALUES ('agent', p_user, m, cost, cost, 'settled', now()) RETURNING id INTO new_id;
    RETURN jsonb_build_object('ok', true, 'ledger_id', new_id);
END $$;

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
