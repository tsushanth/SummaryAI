-- User attribution tracking for Apple Search Ads and other acquisition channels
-- This table stores attribution data received via RevenueCat webhooks

CREATE TABLE IF NOT EXISTS user_attribution (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- General attribution fields
  network TEXT, -- e.g., 'apple_search_ads', 'google_ads', 'facebook'
  campaign TEXT,
  campaign_id TEXT,
  ad_group TEXT,
  ad_group_id TEXT,
  keyword TEXT,
  keyword_id TEXT,
  creative TEXT,
  creative_id TEXT,

  -- Apple Search Ads specific fields
  click_date TEXT,
  conversion_date TEXT,
  country_or_region TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_user_attribution_network ON user_attribution(network);
CREATE INDEX IF NOT EXISTS idx_user_attribution_campaign ON user_attribution(campaign);
CREATE INDEX IF NOT EXISTS idx_user_attribution_keyword ON user_attribution(keyword);
CREATE INDEX IF NOT EXISTS idx_user_attribution_created_at ON user_attribution(created_at);

-- Add comment for documentation
COMMENT ON TABLE user_attribution IS 'Stores user acquisition attribution data from Apple Search Ads and other channels via RevenueCat';
COMMENT ON COLUMN user_attribution.network IS 'Attribution network source (e.g., apple_search_ads)';
COMMENT ON COLUMN user_attribution.campaign IS 'Campaign name from the ad network';
COMMENT ON COLUMN user_attribution.keyword IS 'Search keyword that triggered the ad (Apple Search Ads)';
