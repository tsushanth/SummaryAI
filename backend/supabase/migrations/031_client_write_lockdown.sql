-- Client write access: keep a database built from these files as closed as production, and make three server-owned tables
-- read-only for clients. Safe to run more than once. Undo of part 3: ../rollbacks/031_client_write_lockdown_down.sql.
--
-- The backend writes with the service-role key, which bypasses this. The apps and the website use Supabase for sign-in only;
-- every table write goes through the backend.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Live transcript tables: written by the server only (already so in production since 2026-11-03).
DROP POLICY IF EXISTS "Service role can insert live transcripts" ON public.live_transcripts;
DROP POLICY IF EXISTS "Service role can delete live transcripts" ON public.live_transcripts;
DROP POLICY IF EXISTS "Service role can insert live insights" ON public.live_insights;
DROP POLICY IF EXISTS "Service role can update live insights" ON public.live_insights;
DROP POLICY IF EXISTS "Service role can delete live insights" ON public.live_insights;
REVOKE ALL ON TABLE public.live_transcripts, public.live_insights FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.live_transcripts, public.live_insights FROM authenticated;

-- 2. Profiles and verified phones: a signed-in user may change only their own harmless profile columns; subscription fields
--    and verification state are server-written (already so in production since 2026-11-03).
REVOKE ALL ON TABLE public.profiles, public.verified_phones FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (display_name, avatar_url, preferences, recording_consent_acknowledged_at, terms_accepted_at,
    privacy_policy_accepted_at, updated_at) ON public.profiles TO authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.verified_phones FROM authenticated;
GRANT SELECT (id, user_id, phone_number, verified_at, verification_expires_at, created_at) ON public.verified_phones TO authenticated;

-- 3. Rows whose columns the server acts on (stored file path, linked recording, bot usage times): no client writes.
--    Owner reads are unchanged.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.recordings, public.meetings, public.bot_runs
    FROM anon, authenticated;

COMMIT;
