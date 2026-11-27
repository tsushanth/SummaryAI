-- Free trial of an own number with a phone agent, without a purchase. Safe to run more than once.
-- Undo: ../rollbacks/034_phone_agent_trial_down.sql. Requires 033. Same access rules: server only.
--
-- The server setting PHONE_AGENT_TRIAL only switches the trial on or off. How many people, how long and how much agent
-- time are fixed here and nowhere else. All trial money (number rent, agent drafts, agent minutes, forwarded calls) is
-- company money inside the monthly cap of phone_limits().

BEGIN;
SET LOCAL lock_timeout = '5s';

-- One trial per account and per verified phone number. No foreign key: the row outlives a deleted account, without it.
CREATE TABLE IF NOT EXISTS public.phone_trials (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid,
    number_hash text NOT NULL,                       -- keyed hash of the person's own number
    started_at  timestamptz NOT NULL DEFAULT now(),
    ends_at     timestamptz NOT NULL,
    ended_at    timestamptz,
    end_reason  text
);
CREATE UNIQUE INDEX IF NOT EXISTS phone_trials_user_idx ON public.phone_trials (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS phone_trials_hash_idx ON public.phone_trials (number_hash);
ALTER TABLE public.phone_trials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phone_trials FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.phone_trial_limits() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'max_running',    5,      -- trials open at the same time
        'max_per_month',  5,      -- trials started in a calendar month (UTC)
        'max_numbers',    5,      -- own numbers held at once, paid ones included (the agent service attaches no more)
        'agent_seconds',  900,    -- agent time of one trial, 15 minutes
        'days',           14,
        'drafts',         6       -- agent creations and changes in one trial
    );
$$;

-- Agent time a trial has used: an open call counts at its full reservation, a finished one in started minutes.
CREATE OR REPLACE FUNCTION public.phone_trial_used_seconds(p_user uuid, p_since timestamptz) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(SUM(CASE state WHEN 'released' THEN 0
             WHEN 'settled' THEN CEIL(COALESCE(actual_seconds, reserved_seconds) / 60.0) * 60
             ELSE reserved_seconds END), 0)::integer
      FROM public.phone_ledger
     WHERE user_id = p_user AND kind = 'agent' AND funding = 'company' AND call_id IS NOT NULL AND created_at >= p_since;
$$;

-- Starts a trial, or with p_dry only says whether one could start now.
CREATE OR REPLACE FUNCTION public.phone_trial_start(p_user uuid, p_number_hash text, p_dry boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    tl jsonb := public.phone_trial_limits();
    l2 jsonb := public.phone_limits2();
    m date := public.phone_month();
    t public.phone_trials%ROWTYPE;
    first_cost bigint;
BEGIN
    IF p_user IS NULL OR COALESCE(p_number_hash, '') = '' THEN RAISE EXCEPTION 'phone_trial_start: missing argument'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    SELECT * INTO t FROM public.phone_trials WHERE user_id = p_user;
    IF FOUND THEN
        IF t.ended_at IS NULL AND t.ends_at > now() THEN RETURN jsonb_build_object('ok', true, 'already', true); END IF;
        RETURN jsonb_build_object('ok', false, 'reason', 'trial_used');
    END IF;
    IF EXISTS (SELECT 1 FROM public.phone_trials WHERE number_hash = p_number_hash) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'trial_used');
    END IF;
    IF (SELECT count(*) FROM public.phone_trials WHERE ended_at IS NULL) >= (tl->>'max_running')::int
       OR (SELECT count(*) FROM public.phone_trials WHERE public.phone_month(started_at) = m) >= (tl->>'max_per_month')::int
       OR (SELECT count(*) FROM public.phone_numbers WHERE kind = 'personal' AND status <> 'released') >= (tl->>'max_numbers')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'trial_full');
    END IF;
    -- Room for at least the number, one agent and one agent minute.
    first_cost := (l2->>'rent_micro')::bigint + (l2->>'agent_draft_micro')::bigint + (l2->>'agent_min_micro')::bigint
                + (public.phone_limits()->>'summary_micro')::bigint;
    IF EXISTS (SELECT 1 FROM public.phone_halts WHERE month = m)
       OR public.phone_month_spent(m) + first_cost > (public.phone_limits()->>'cap_micro')::bigint THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'budget_used');
    END IF;
    IF NOT p_dry THEN
        INSERT INTO public.phone_trials (user_id, number_hash, ends_at)
        VALUES (p_user, p_number_hash, now() + make_interval(days => (tl->>'days')::int));
    END IF;
    RETURN jsonb_build_object('ok', true);
END $$;

-- The number could not be bought: the trial was never had.
CREATE OR REPLACE FUNCTION public.phone_trial_cancel(p_user uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    DELETE FROM public.phone_trials t WHERE t.user_id = p_user AND t.ended_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.phone_numbers n WHERE n.user_id = p_user AND n.kind = 'personal' AND n.status <> 'released');
    RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.phone_trial_end(p_user uuid, p_reason text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    UPDATE public.phone_trials SET ended_at = now(), end_reason = left(p_reason, 40) WHERE user_id = p_user AND ended_at IS NULL;
    RETURN FOUND;
END $$;

-- Ends trials that hold no number: expired ones, all of them when the trial is switched off, and abandoned starts.
CREATE OR REPLACE FUNCTION public.phone_trial_sweep(p_switched_off boolean) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    UPDATE public.phone_trials t
       SET ended_at = now(), end_reason = CASE WHEN p_switched_off THEN 'switched_off' WHEN t.ends_at <= now() THEN 'expired' ELSE 'no_number' END
     WHERE t.ended_at IS NULL
       AND (p_switched_off OR t.user_id IS NULL OR t.ends_at <= now() OR t.started_at < now() - interval '1 hour')
       AND NOT EXISTS (SELECT 1 FROM public.phone_numbers x WHERE x.user_id = t.user_id AND x.kind = 'personal' AND x.status <> 'released');
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.phone_trial_state(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'started_at', t.started_at, 'ends_at', t.ends_at, 'ended_at', t.ended_at, 'end_reason', t.end_reason,
        'running', t.ended_at IS NULL AND t.ends_at > now(),
        'seconds_left', GREATEST((public.phone_trial_limits()->>'agent_seconds')::int - public.phone_trial_used_seconds(p_user, t.started_at), 0),
        'open_call', EXISTS (SELECT 1 FROM public.phone_ledger g WHERE g.user_id = p_user AND g.state = 'reserved' AND g.kind IN ('call', 'inbound', 'agent')))
      FROM public.phone_trials t WHERE t.user_id = p_user;
$$;

-- Replaces the 033 function. Company-paid agent time now exists only inside a running trial.
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
    t public.phone_trials%ROWTYPE;
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
            SELECT * INTO t FROM public.phone_trials WHERE user_id = p_user AND ended_at IS NULL AND ends_at > now();
            IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_trial'); END IF;
            left_seconds := (public.phone_trial_limits()->>'agent_seconds')::int - public.phone_trial_used_seconds(p_user, t.started_at);
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

-- Replaces the 033 function. Without a live subscription an agent can be made only inside a running trial, a few times.
CREATE OR REPLACE FUNCTION public.phone_reserve_draft(p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    m date := public.phone_month();
    cost bigint := (public.phone_limits2()->>'agent_draft_micro')::bigint;
    new_id bigint;
    t public.phone_trials%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('public.phone_ledger'));
    IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'agent' AND call_id IS NULL AND user_id = p_user AND state <> 'released'
          AND created_at > now() - interval '24 hours') >= (public.phone_limits2()->>'drafts_user_day')::int THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'user_limit');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.phone_subscriptions s WHERE s.user_id = p_user AND s.expires_at > now()) THEN
        SELECT * INTO t FROM public.phone_trials WHERE user_id = p_user AND ended_at IS NULL AND ends_at > now();
        IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_trial'); END IF;
        IF (SELECT count(*) FROM public.phone_ledger WHERE kind = 'agent' AND call_id IS NULL AND user_id = p_user AND state <> 'released'
              AND created_at >= t.started_at) >= (public.phone_trial_limits()->>'drafts')::int THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'user_limit');
        END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM public.phone_halts WHERE month = m)
       OR public.phone_month_spent(m) + cost > (public.phone_limits()->>'cap_micro')::bigint THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'budget_used');
    END IF;
    INSERT INTO public.phone_ledger (kind, user_id, month, reserved_micro, actual_micro, state, settled_at)
    VALUES ('agent', p_user, m, cost, cost, 'settled', now()) RETURNING id INTO new_id;
    RETURN jsonb_build_object('ok', true, 'ledger_id', new_id);
END $$;

-- The agent service refused before doing any work: nothing was spent.
CREATE OR REPLACE FUNCTION public.phone_release_draft(p_ledger_id bigint) RETURNS void LANGUAGE sql AS $$
    UPDATE public.phone_ledger SET state = 'released', actual_micro = 0 WHERE id = p_ledger_id AND kind = 'agent' AND call_id IS NULL;
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
