-- Rollback for migrations/024_account_purges.sql. NOT applied anywhere. Safe to run: the table only holds purge
-- bookkeeping. Dropping it while purges are pending loses the retry list; the backend then falls back to
-- "fail closed" (external failure blocks account deletion, user retries).
drop index if exists account_purges_retry_idx;
drop table if exists account_purges;
