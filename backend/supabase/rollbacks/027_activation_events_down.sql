-- Rollback for migrations/027_activation_events.sql. NOT applied anywhere. Drops only first-party funnel data (no user content).
drop index if exists activation_events_name_created_idx;
drop index if exists activation_events_anon_idx;
drop index if exists activation_events_user_idx;
drop table if exists activation_events;
drop table if exists signup_attribution;
