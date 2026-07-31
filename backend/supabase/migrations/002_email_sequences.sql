-- Email sequence tracking for Meeting Mind drip campaigns
-- Run in: https://supabase.com/dashboard/project/mlofjzlmncgnhxbiuemf/sql

CREATE TABLE IF NOT EXISTS user_emails (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    template     TEXT NOT NULL,  -- 'promo_1', 'promo_2', 'promo_3', 'welcome'
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status       TEXT NOT NULL DEFAULT 'sent'  -- 'sent', 'bounced', 'delivered'
);

CREATE INDEX idx_user_emails_user_id   ON user_emails(user_id);
CREATE INDEX idx_user_emails_template  ON user_emails(template);
CREATE INDEX idx_user_emails_sent_at   ON user_emails(sent_at);

-- Backfill: run scripts/backfill-promo1.ts to import the Resend CSV
-- and mark those users as promo_1 sent so Touch 1 isn't re-sent to them.
-- See: scripts/backfill-promo1.ts
