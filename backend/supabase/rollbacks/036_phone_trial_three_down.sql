-- Undo of 036_phone_trial_three.sql: back to 5 trials open at once and 5 started in a calendar month.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phone_trial_limits() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'max_running',    5,      -- trials open at the same time
        'max_per_month',  5,      -- trials started in a calendar month (UTC)
        'max_numbers',    5,      -- own numbers held at once, paid ones included (the agent service attaches no more)
        'agent_seconds',  900,    -- agent time of one trial, 15 minutes
        'days',           14,
        'drafts',         6       -- agent creations and changes in one trial
    );
$$;

COMMIT;
