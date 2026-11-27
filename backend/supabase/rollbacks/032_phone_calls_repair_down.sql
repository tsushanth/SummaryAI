-- Undo of 032_phone_calls_repair.sql. Only with phone calls switched off: the backend refuses every call without these.
-- The ledger is the record of what was spent this month; export it before dropping it.
-- The write revoke on phone_calls is deliberately NOT undone (clients never need to write it).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.phone_funnel(timestamptz);
DROP FUNCTION IF EXISTS public.phone_halt(text);
DROP FUNCTION IF EXISTS public.phone_budget(uuid, text);
DROP FUNCTION IF EXISTS public.phone_release_call(uuid, uuid);
DROP FUNCTION IF EXISTS public.phone_settle_call(uuid, integer, integer, boolean);
DROP FUNCTION IF EXISTS public.phone_notice_served(uuid, text);
DROP FUNCTION IF EXISTS public.phone_claim_call(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.phone_reserve_call(uuid, uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.phone_release_verification(bigint);
DROP FUNCTION IF EXISTS public.phone_reserve_verification(uuid, text);
DROP FUNCTION IF EXISTS public.phone_release_stale();
DROP FUNCTION IF EXISTS public.phone_minutes_used(uuid, text, date);
DROP FUNCTION IF EXISTS public.phone_month_spent(date);
DROP FUNCTION IF EXISTS public.phone_month(timestamptz);
DROP FUNCTION IF EXISTS public.phone_limits();
DROP TABLE IF EXISTS public.phone_halts;
DROP TABLE IF EXISTS public.phone_ledger;
DROP INDEX IF EXISTS public.verified_phones_one_owner_idx;
ALTER TABLE public.verified_phones DROP CONSTRAINT IF EXISTS verified_phones_status_check;
ALTER TABLE public.verified_phones DROP COLUMN IF EXISTS status, DROP COLUMN IF EXISTS twilio_caller_id_sid,
    DROP COLUMN IF EXISTS validation_call_sid, DROP COLUMN IF EXISTS failure_reason, DROP COLUMN IF EXISTS ledger_id;
ALTER TABLE public.phone_calls DROP COLUMN IF EXISTS twilio_account, DROP COLUMN IF EXISTS output_language,
    DROP COLUMN IF EXISTS call_language, DROP COLUMN IF EXISTS consent_version, DROP COLUMN IF EXISTS failure_reason,
    DROP COLUMN IF EXISTS recording_stored_at, DROP COLUMN IF EXISTS recording_deleted_at, DROP COLUMN IF EXISTS transcript_result;
-- activation_events keeps allowing 'phone_step' so that existing rows stay valid.
COMMIT;
