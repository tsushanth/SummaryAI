-- Undo of 033_phone_numbers_agents.sql. Release every number at the carrier first: dropping the table forgets them.
-- Re-apply 032 afterwards to restore the two functions this migration replaced (phone_minutes_used, phone_notice_served).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.phone_reserve_draft(uuid);
DROP FUNCTION IF EXISTS public.phone_settle_leg(uuid, integer, boolean);
DROP FUNCTION IF EXISTS public.phone_reserve_leg(text, uuid, uuid, uuid, text, text, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.phone_sub_left(uuid, text);
DROP FUNCTION IF EXISTS public.phone_assign_route(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.phone_release_rent(uuid);
DROP FUNCTION IF EXISTS public.phone_book_rent(uuid, boolean);
DROP FUNCTION IF EXISTS public.phone_limits2();
DROP TABLE IF EXISTS public.phone_return_routes;
DROP TABLE IF EXISTS public.phone_subscriptions;
DROP TABLE IF EXISTS public.phone_numbers;
ALTER TABLE public.phone_calls DROP COLUMN IF EXISTS direction, DROP COLUMN IF EXISTS agent_id, DROP COLUMN IF EXISTS agent_result;
-- phone_ledger keeps number_id and the wider kind check so that booked rows stay valid.
COMMIT;
