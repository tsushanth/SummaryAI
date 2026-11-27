-- Free trial places: 3 open at once and 3 started in a calendar month (owner, 27 November 2026; 034 set 5 and 5). Five fully used
-- trials took nearly the whole monthly cap, which free calling shares. Nothing else changes. Safe to run more than once.
-- Requires 034; running 034 again puts 5 back. Undo: ../rollbacks/036_phone_trial_three_down.sql.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phone_trial_limits() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'max_running',    3,      -- trials open at the same time
        'max_per_month',  3,      -- trials started in a calendar month (UTC)
        'max_numbers',    5,      -- own numbers held at once, paid ones included (the agent service attaches no more)
        'agent_seconds',  900,    -- agent time of one trial, 15 minutes
        'days',           14,
        'drafts',         6       -- agent creations and changes in one trial
    );
$$;

COMMIT;
