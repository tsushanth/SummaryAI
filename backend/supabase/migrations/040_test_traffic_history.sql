-- Re-marks the history under the rules of 039 and points the activation harness at the same account rule. Run only after
-- 039 AND after the rules are inserted (docs/TEST_TRAFFIC.md). Safe to run more than once.
-- Undo: ../rollbacks/040_test_traffic_history_down.sql.
--
-- Every changed row carries props.test_backfill: 'moved' (it already said test; only its platform was renamed) or
-- 'marked' (newly marked here). Nothing is deleted. To preview, run it with the last line changed to ROLLBACK.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.test_traffic_rules WHERE kind IN ('account_email', 'user_id') AND label <> 'not_test') THEN
        RAISE EXCEPTION 'test_traffic_rules has no account rule: insert the rules first, or our own accounts would count as people';
    END IF;
END $$;

-- 1. Rows a sender or the server already called test.
UPDATE public.activation_events
   SET platform = platform || '_test', props = props || '{"test_backfill": "moved"}'::jsonb
 WHERE props->>'test' = 'true' AND platform IN ('web', 'android', 'ios');

-- 2. Rows the rules cover: by account, by browser or install, by the account that signed up in that browser, or by a
--    test-only build while its rule ran.
WITH why AS (
    SELECT e.id, COALESCE(
             CASE WHEN e.user_id IS NOT NULL THEN public.test_account_reason(e.user_id, false) END,
             (SELECT r.label FROM public.test_traffic_rules r WHERE r.kind = 'anon_id' AND r.value = e.anon_id LIMIT 1),
             (SELECT public.test_account_reason(a.user_id, false) FROM public.signup_attribution a
               WHERE a.anon_id = e.anon_id AND public.test_account_reason(a.user_id, false) IS NOT NULL LIMIT 1),
             (SELECT 'internal_build' FROM public.test_traffic_rules r
               WHERE r.kind = 'android_version' AND e.platform = 'android' AND r.value = e.app_version AND e.created_at < r.ends_at LIMIT 1)
           ) AS reason
      FROM public.activation_events e
     WHERE COALESCE(e.props->>'test', '') <> 'true'
)
UPDATE public.activation_events e
   SET props = e.props || jsonb_build_object('test', true, 'test_reason', why.reason, 'test_backfill', 'marked'),
       platform = CASE WHEN e.platform IN ('web', 'android', 'ios') THEN e.platform || '_test' ELSE e.platform END
  FROM why
 WHERE e.id = why.id AND why.reason IS NOT NULL;

-- 3. The other rows of those browsers and installs.
UPDATE public.activation_events e
   SET props = e.props || '{"test": true, "test_reason": "same_install", "test_backfill": "marked"}'::jsonb,
       platform = CASE WHEN e.platform IN ('web', 'android', 'ios') THEN e.platform || '_test' ELSE e.platform END
 WHERE COALESCE(e.props->>'test', '') <> 'true' AND e.anon_id <> 'server-phone-events'
   AND EXISTS (SELECT 1 FROM public.activation_events t
                WHERE t.anon_id = e.anon_id AND t.props->>'test' = 'true' AND COALESCE(t.props->>'test_reason', '') <> 'internal_build');

-- 4. The activation harness reads accounts through this view (ops-notes harness/sql/harness_readonly_role.sql). Same
--    columns; "internal or test" now means the rule above. Re-applying that file would put its older pattern back.
DO $$
BEGIN
    IF to_regclass('harness.activation_users') IS NOT NULL THEN
        EXECUTE $view$
            CREATE OR REPLACE VIEW harness.activation_users WITH (security_invoker = off) AS
            SELECT u.id,
                   u.created_at,
                   u.last_sign_in_at,
                   COALESCE(u.raw_app_meta_data->>'provider', 'unknown') AS provider,
                   COALESCE(u.email ~* '@privaterelay\.appleid\.com$', false) AS is_private_relay,
                   (u.email IS NULL OR t.user_id IS NOT NULL) AS is_internal_or_test,
                   COALESCE(u.email ~* 'mmsynth', false) AS is_synthetic
              FROM auth.users u
              LEFT JOIN public.test_accounts() t ON t.user_id = u.id
        $view$;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'harness_readonly') THEN
            GRANT EXECUTE ON FUNCTION public.test_accounts() TO harness_readonly;
        END IF;
    END IF;
END $$;

-- What is marked now, for the person applying this.
SELECT platform, props->>'test_reason' AS reason, props->>'test_backfill' AS backfill, count(*) AS rows
  FROM public.activation_events WHERE props->>'test' = 'true' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

COMMIT;
