-- Marks our own and automated traffic in one place, so that counts and monitors only see people. Safe to run more than
-- once. Undo: ../rollbacks/039_test_traffic_down.sql. Requires 027 and 032.
--
-- Which accounts are ours is DATA (test_traffic_rules), never code: this repository is public, so no address of ours is
-- written here. Insert the rules after applying (see docs/TEST_TRAFFIC.md). Only patterns that are automated by
-- construction are built in. Changes no existing row (history is migration 040).
--
-- A test row in activation_events gets props.test = true, props.test_reason, and its platform renamed from web / android
-- / ios to web_test / android_test / ios_test, so a reader that asks for platform = 'web' or 'android' never sees it.
-- The mark is stored on the row because a deleted throwaway account leaves its anonymous rows behind.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.test_traffic_rules (
    id         bigserial PRIMARY KEY,
    -- account_email: this address, with any +alias (Gmail: dots ignored). email_domain: every address on it.
    -- user_id: one account. anon_id: one browser or install. android_version: a build that only testers have, until ends_at.
    kind       text NOT NULL CHECK (kind IN ('account_email', 'email_domain', 'user_id', 'anon_id', 'android_version')),
    value      text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 200),
    -- Shown as the reason in counts (owner, company, review_login, ...). 'not_test' on a user_id forces a real person.
    label      text NOT NULL CHECK (label ~ '^[a-z][a-z0-9_]{0,39}$'),
    ends_at    timestamptz,
    note       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, value),
    -- A version rule must expire: left open it would hide real people once the build is published.
    CHECK (kind <> 'android_version' OR ends_at IS NOT NULL)
);
ALTER TABLE public.test_traffic_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.test_traffic_rules FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.test_traffic_rules_id_seq FROM anon, authenticated;

-- Lower case, without a +alias; Gmail ignores dots and googlemail.com is the same mailbox.
CREATE OR REPLACE FUNCTION public.test_email_key(p_email text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
    SELECT CASE WHEN d IN ('gmail.com', 'googlemail.com') THEN replace(l, '.', '') || '@gmail.com' ELSE l || '@' || d END
      FROM (SELECT split_part(split_part(lower(btrim(p_email)), '@', 1), '+', 1) AS l,
                   split_part(lower(btrim(p_email)), '@', 2) AS d) s
$$;

-- Why an account is not a person to count, or NULL. p_network also applies the rule that can change as a person signs
-- in again (every session from Google's own network, as in the outcome checks): used for counts, never stored on a row.
CREATE OR REPLACE FUNCTION public.test_account_reason(p_user uuid, p_network boolean DEFAULT true) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM public.test_traffic_rules n
                    WHERE n.kind = 'user_id' AND n.label = 'not_test' AND lower(n.value) = p_user::text) THEN NULL
      ELSE COALESCE(
        (SELECT r.label
           FROM public.test_traffic_rules r
           LEFT JOIN auth.users u ON u.id = p_user
          WHERE (r.ends_at IS NULL OR r.ends_at > now()) AND r.label <> 'not_test'
            AND ((r.kind = 'user_id' AND lower(r.value) = p_user::text)
              OR (r.kind = 'account_email' AND public.test_email_key(u.email) = public.test_email_key(r.value))
              OR (r.kind = 'email_domain' AND split_part(lower(u.email), '@', 2) = lower(r.value)))
          ORDER BY CASE r.kind WHEN 'user_id' THEN 1 WHEN 'account_email' THEN 2 ELSE 3 END, r.id
          LIMIT 1),
        (SELECT CASE
              WHEN u.email ~* '@example\.(com|org|net)$' THEN 'reserved_domain'
              WHEN u.email ~* '@cloudtestlabaccounts\.com$' THEN 'play_test_lab'
              WHEN u.email ~* '\.[0-9]{5}@gmail\.com$' THEN 'play_robot'
              WHEN u.email ~* '\+mmsynth[a-z0-9]*@' THEN 'synthetic'
            END
           FROM auth.users u WHERE u.id = p_user),
        CASE WHEN p_network
              AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = p_user)
              AND NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = p_user AND NOT COALESCE(s.ip <<= ANY (ARRAY[
                    '66.249.64.0/19', '66.102.0.0/20', '64.233.160.0/19', '72.14.192.0/18', '74.125.0.0/16', '108.177.0.0/17',
                    '142.250.0.0/15', '172.217.0.0/16', '172.253.0.0/16', '173.194.0.0/16', '192.178.0.0/15', '209.85.128.0/17',
                    '216.58.192.0/19', '216.239.32.0/19', '2001:4860::/32', '2404:6800::/32', '2607:f8b0::/32',
                    '2800:3f0::/32', '2a00:1450::/32', '2c0f:fb50::/32']::inet[]), false))
             THEN 'google_network' END)
    END
$$;

-- Every account that is not a person to count. Owner queries: WHERE user_id NOT IN (SELECT user_id FROM public.test_accounts()).
CREATE OR REPLACE FUNCTION public.test_accounts() RETURNS TABLE (user_id uuid, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT u.id, w.reason
      FROM auth.users u CROSS JOIN LATERAL (SELECT public.test_account_reason(u.id) AS reason) w
     WHERE w.reason IS NOT NULL
$$;

-- The same for a handful of accounts (what the backend asks).
CREATE OR REPLACE FUNCTION public.test_accounts_among(p_users uuid[]) RETURNS TABLE (user_id uuid, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT x.id, w.reason
      FROM (SELECT DISTINCT unnest(p_users) AS id) x CROSS JOIN LATERAL (SELECT public.test_account_reason(x.id) AS reason) w
     WHERE w.reason IS NOT NULL
$$;

-- Marks every earlier row of one browser or install. The server's own phone rows share one anon_id and are never swept.
CREATE OR REPLACE FUNCTION public.test_mark_anon(p_anon text, p_reason text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
    IF p_anon IS NULL OR p_anon = 'server-phone-events' OR p_reason IS NULL THEN RETURN 0; END IF;
    UPDATE public.activation_events
       SET props = props || jsonb_build_object('test', true, 'test_reason', p_reason),
           platform = CASE WHEN platform IN ('web', 'android', 'ios') THEN platform || '_test' ELSE platform END
     WHERE anon_id = p_anon AND COALESCE(props->>'test', '') <> 'true';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.activation_events_mark_test() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE why text;
BEGIN
    BEGIN
        IF NEW.props->>'test' = 'true' THEN
            -- Said by the sender: debug or side-loaded build, Test Lab, browser automation, the server's own check.
            why := COALESCE(NEW.props->>'test_reason', 'client');
        ELSE
            why := COALESCE(
              CASE WHEN NEW.user_id IS NOT NULL THEN public.test_account_reason(NEW.user_id, false) END,
              (SELECT r.label FROM public.test_traffic_rules r
                WHERE r.kind = 'anon_id' AND r.value = NEW.anon_id AND (r.ends_at IS NULL OR r.ends_at > now()) LIMIT 1),
              (SELECT 'internal_build' FROM public.test_traffic_rules r
                WHERE r.kind = 'android_version' AND NEW.platform = 'android' AND r.value = NEW.app_version AND r.ends_at > now() LIMIT 1),
              -- The same browser or install as an earlier test row. Not after a version rule alone: that install
              -- counts again once its build is a published one.
              (SELECT 'same_install' FROM public.activation_events e
                WHERE NEW.anon_id <> 'server-phone-events' AND e.anon_id = NEW.anon_id AND e.props->>'test' = 'true'
                  AND COALESCE(e.props->>'test_reason', '') <> 'internal_build' LIMIT 1));
        END IF;
        IF why IS NOT NULL THEN
            NEW.props := COALESCE(NEW.props, '{}'::jsonb) || jsonb_build_object('test', true, 'test_reason', why);
            IF NEW.platform IN ('web', 'android', 'ios') THEN NEW.platform := NEW.platform || '_test'; END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'activation_events_mark_test failed: %', SQLSTATE;  -- measuring must never lose the event
    END;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS activation_events_mark_test ON public.activation_events;
CREATE TRIGGER activation_events_mark_test BEFORE INSERT ON public.activation_events
    FOR EACH ROW EXECUTE FUNCTION public.activation_events_mark_test();

-- Web events carry no account. signup_attribution is where a browser meets one, so a test signup marks that browser.
CREATE OR REPLACE FUNCTION public.signup_attribution_mark_test() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    BEGIN
        PERFORM public.test_mark_anon(NEW.anon_id, public.test_account_reason(NEW.user_id, false));
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'signup_attribution_mark_test failed: %', SQLSTATE;
    END;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS signup_attribution_mark_test ON public.signup_attribution;
CREATE TRIGGER signup_attribution_mark_test AFTER INSERT ON public.signup_attribution
    FOR EACH ROW EXECUTE FUNCTION public.signup_attribution_mark_test();

-- Functions are reachable through the data API unless revoked: server only.
DO $$
DECLARE f record;
BEGIN
    FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN ('test_email_key', 'test_account_reason', 'test_accounts',
                 'test_accounts_among', 'test_mark_anon', 'activation_events_mark_test', 'signup_attribution_mark_test')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
    END LOOP;
END $$;

-- The data API must see the new function (the backend calls test_accounts_among).
NOTIFY pgrst, 'reload schema';

COMMIT;
