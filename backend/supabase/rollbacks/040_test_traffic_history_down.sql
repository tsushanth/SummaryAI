-- Rollback for migrations/040_test_traffic_history.sql: restores the rows it changed, then the harness view must be
-- restored by re-applying harness/sql/harness_readonly_role.sql from the ops-notes repository (its view definition is
-- not copied here). Until then the view keeps using public.test_accounts(), so do this before 039's rollback.

BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE public.activation_events
   SET props = props - 'test' - 'test_reason' - 'test_backfill',
       platform = CASE WHEN platform IN ('web_test', 'android_test', 'ios_test') THEN left(platform, -5) ELSE platform END
 WHERE props->>'test_backfill' = 'marked';

UPDATE public.activation_events
   SET props = props - 'test_backfill',
       platform = CASE WHEN platform IN ('web_test', 'android_test', 'ios_test') THEN left(platform, -5) ELSE platform END
 WHERE props->>'test_backfill' = 'moved';

COMMIT;
