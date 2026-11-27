-- Rollback for migrations/039_test_traffic.sql. Run 040's rollback first if 040 was applied (the harness view uses
-- test_accounts()). Drops the triggers, the functions and the rules table (the rules are lost: keep your seed file).
-- Rows marked since stay marked; the query at the end of this file unmarks them if wanted.

BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS signup_attribution_mark_test ON public.signup_attribution;
DROP TRIGGER IF EXISTS activation_events_mark_test ON public.activation_events;
DROP FUNCTION IF EXISTS public.signup_attribution_mark_test();
DROP FUNCTION IF EXISTS public.activation_events_mark_test();
DROP FUNCTION IF EXISTS public.test_mark_anon(text, text);
DROP FUNCTION IF EXISTS public.test_anon_has_person(text);
DROP FUNCTION IF EXISTS public.test_accounts_among(uuid[]);
DROP FUNCTION IF EXISTS public.test_accounts();
DROP FUNCTION IF EXISTS public.test_account_reason(uuid, boolean);
DROP FUNCTION IF EXISTS public.test_email_key(text);
DROP TABLE IF EXISTS public.test_traffic_rules;
COMMIT;

-- Optional: put marked rows back under their platform (keeps props.test, which older readers understand).
-- UPDATE public.activation_events SET platform = left(platform, -5) WHERE platform IN ('web_test', 'android_test', 'ios_test');
