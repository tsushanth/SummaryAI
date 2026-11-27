-- Undo of 034_phone_agent_trial.sql. Switch the trial off first and wait until its numbers are released.
-- Re-apply 033 afterwards to restore the two functions this migration replaced (phone_reserve_leg, phone_reserve_draft).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.phone_step_counts(timestamptz);
DROP FUNCTION IF EXISTS public.phone_release_draft(bigint);
DROP FUNCTION IF EXISTS public.phone_trial_state(uuid);
DROP FUNCTION IF EXISTS public.phone_trial_sweep(boolean);
DROP FUNCTION IF EXISTS public.phone_trial_end(uuid, text);
DROP FUNCTION IF EXISTS public.phone_trial_cancel(uuid);
DROP FUNCTION IF EXISTS public.phone_trial_start(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.phone_trial_used_seconds(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.phone_trial_limits();
DROP TABLE IF EXISTS public.phone_trials;
COMMIT;
