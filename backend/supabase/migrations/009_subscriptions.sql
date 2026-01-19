-- Subscription Schema for Meeting Mind
-- Adds subscription tracking fields to profiles for Stripe, App Store, and Play Store

-- ============================================================================
-- ADD SUBSCRIPTION FIELDS TO PROFILES
-- ============================================================================

-- Subscription status
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'free'
    CHECK (subscription_status IN ('free', 'trialing', 'active', 'past_due', 'canceled'));

-- Provider (stripe, app_store, play_store)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_provider TEXT
    CHECK (subscription_provider IS NULL OR subscription_provider IN ('stripe', 'app_store', 'play_store'));

-- Plan type
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_plan TEXT
    CHECK (subscription_plan IS NULL OR subscription_plan IN ('weekly', 'monthly', 'yearly'));

-- Expiration date
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- Stripe-specific fields
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- When the subscription started
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS subscribed_at TIMESTAMPTZ;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_subscription_status
    ON profiles(subscription_status);

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
    ON profiles(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription_id
    ON profiles(stripe_subscription_id);

-- ============================================================================
-- STRIPE WEBHOOK EVENTS LOG (for idempotency)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    id TEXT PRIMARY KEY,  -- Stripe event ID
    type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB
);

-- ============================================================================
-- SERVICE ROLE POLICY FOR PROFILES (update subscription fields)
-- ============================================================================

DROP POLICY IF EXISTS profiles_service_all ON profiles;
CREATE POLICY profiles_service_all ON profiles
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role')
    WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- Done!
SELECT 'Subscription schema added successfully!' as status;
