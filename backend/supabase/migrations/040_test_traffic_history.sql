-- Re-marks the history under the rules of 039 and points the activation harness at the same account rule. Run only after
-- 039 AND after the rules are inserted (docs/TEST_TRAFFIC.md). Safe to run more than once.
-- Undo: ../rollbacks/040_test_traffic_history_down.sql.
--
-- Every changed row carries props.test_backfill: 'moved' (it already said test; only its platform was renamed) or
-- 'marked' (newly marked here; a test value it had before is kept in props.test_was for the rollback). Nothing is
-- deleted. To preview, run it with the last line changed to ROLLBACK.

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

-- 2. Rows the rules cover: by account, by test-only build while its rule ran, by listed browser or install, or by the
--    test account that signed up in that browser. Nothing is taken from a browser or install for a row that carries a
--    person's account, and a sign-up says nothing about a browser a person has used too.
WITH who AS (
    SELECT e.id, e.anon_id, e.platform, e.app_version, e.created_at,
           CASE WHEN e.user_id IS NOT NULL THEN public.test_account_reason(e.user_id, false) END AS account,
           e.user_id IS NOT NULL AND public.test_account_reason(e.user_id, false) IS NULL AS person
      FROM public.activation_events e
     WHERE COALESCE(e.props->>'test', '') <> 'true'
),
why AS (
    SELECT w.id, COALESCE(
             w.account,
             (SELECT r.label FROM public.test_traffic_rules r
               WHERE NOT w.person AND r.kind = 'anon_id' AND r.value = w.anon_id LIMIT 1),
             (SELECT public.test_account_reason(a.user_id, false) FROM public.signup_attribution a
               WHERE NOT w.person AND a.anon_id = w.anon_id AND public.test_account_reason(a.user_id, false) IS NOT NULL
                 AND NOT public.test_anon_has_person(w.anon_id) LIMIT 1),
             (SELECT 'internal_build' FROM public.test_traffic_rules r
               WHERE r.kind = 'android_version' AND w.platform = 'android' AND r.value = w.app_version AND w.created_at < r.ends_at LIMIT 1)
           ) AS reason
      FROM who w
)
UPDATE public.activation_events e
   SET props = e.props
               || CASE WHEN e.props ? 'test' THEN jsonb_build_object('test_was', e.props->'test') ELSE '{}'::jsonb END
               || jsonb_build_object('test', true, 'test_reason', why.reason, 'test_backfill', 'marked'),
       platform = CASE WHEN e.platform IN ('web', 'android', 'ios') THEN e.platform || '_test' ELSE e.platform END
  FROM why
 WHERE e.id = why.id AND why.reason IS NOT NULL;

-- 3. The other rows of those browsers and installs, where no person has used them.
UPDATE public.activation_events e
   SET props = e.props
               || CASE WHEN e.props ? 'test' THEN jsonb_build_object('test_was', e.props->'test') ELSE '{}'::jsonb END
               || '{"test": true, "test_reason": "same_install", "test_backfill": "marked"}'::jsonb,
       platform = CASE WHEN e.platform IN ('web', 'android', 'ios') THEN e.platform || '_test' ELSE e.platform END
 WHERE COALESCE(e.props->>'test', '') <> 'true' AND e.anon_id <> 'server-phone-events'
   AND (e.user_id IS NULL OR public.test_account_reason(e.user_id, false) IS NOT NULL)
   AND EXISTS (SELECT 1 FROM public.activation_events t
                WHERE t.anon_id = e.anon_id AND t.props->>'test' = 'true' AND COALESCE(t.props->>'test_reason', '') <> 'internal_build')
   AND NOT public.test_anon_has_person(e.anon_id);

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
