-- Reverse of part 3 of ../migrations/031_client_write_lockdown.sql: signed-in users can again write their own rows in
-- recordings, meetings and bot_runs (row-level policies still apply). anon held no grant before the migration.
-- Parts 1 and 2 only record the state production already had; reversing them would reopen client access, so they are not undone here.
BEGIN;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.recordings, public.meetings, public.bot_runs
    TO authenticated;
COMMIT;
