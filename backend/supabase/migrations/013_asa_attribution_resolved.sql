-- Stores Apple Search Ads attribution tokens resolved server-side via
-- https://api-adservices.apple.com/api/v1/. Populated by POST /api/attribution/apple-search-ads
-- which is called from the iOS client on first launch (before any user sign-in),
-- so this table is keyed by token_hash rather than user_id. The user_id column
-- is filled in later (best-effort) when we can link a token to a profile.

CREATE TABLE IF NOT EXISTS asa_attribution_resolved (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    TEXT UNIQUE NOT NULL,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,

  bundle_id     TEXT NOT NULL,
  app_version   TEXT,
  platform      TEXT DEFAULT 'ios',

  -- Apple resolver response fields (https://developer.apple.com/documentation/adservices)
  attribution        BOOLEAN,        -- false on TestFlight, organic, or limited-tracking
  org_id             BIGINT,
  campaign_id        BIGINT,
  ad_group_id        BIGINT,
  keyword_id         BIGINT,
  ad_id              BIGINT,
  conversion_type    TEXT,           -- e.g. 'Download', 'Redownload'
  country_or_region  TEXT,
  click_date         TIMESTAMPTZ,

  raw_response       JSONB,          -- full resolver payload for debugging
  resolver_status    INT,            -- HTTP status from Apple's resolver
  resolver_error     TEXT,           -- error message if call failed

  created_at    TIMESTAMPTZ DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asa_attr_campaign       ON asa_attribution_resolved(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asa_attr_keyword        ON asa_attribution_resolved(keyword_id)  WHERE keyword_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asa_attr_user_id        ON asa_attribution_resolved(user_id)     WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asa_attr_attribution    ON asa_attribution_resolved(attribution) WHERE attribution = TRUE;
CREATE INDEX IF NOT EXISTS idx_asa_attr_created_at     ON asa_attribution_resolved(created_at DESC);

COMMENT ON TABLE asa_attribution_resolved IS 'Server-resolved Apple Search Ads attribution tokens (raw, pre-user-linking).';
COMMENT ON COLUMN asa_attribution_resolved.token_hash IS 'SHA-256 of the AdServices token; used as natural PK to dedup retries.';
COMMENT ON COLUMN asa_attribution_resolved.attribution IS 'TRUE only when the install came from a paid ASA placement.';
