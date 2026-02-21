-- Ad Optimizer Schema
-- Multi-product automated ad optimization for Apple Search Ads

-- Products registry (each iOS app you want to optimize)
CREATE TABLE asa_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Product identification
  name TEXT NOT NULL,
  bundle_id TEXT UNIQUE NOT NULL,

  -- API authentication
  api_key TEXT UNIQUE NOT NULL,

  -- Apple Search Ads credentials (encrypted in production)
  asa_client_id TEXT,
  asa_team_id TEXT,
  asa_key_id TEXT,
  asa_private_key TEXT, -- base64 encoded, encrypt in production
  asa_org_id TEXT,

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-product optimization configuration
CREATE TABLE asa_product_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES asa_products(id) ON DELETE CASCADE,

  -- Cost thresholds
  target_cps DECIMAL(10,2) DEFAULT 15.00, -- target cost per subscriber
  max_cps DECIMAL(10,2) DEFAULT 25.00,    -- pause if above this

  -- Evaluation thresholds
  min_taps_to_evaluate INT DEFAULT 30,    -- minimum taps before making decisions
  min_installs_to_boost INT DEFAULT 3,    -- minimum installs to consider boosting

  -- Bid adjustments
  bid_increase_pct DECIMAL(4,3) DEFAULT 0.150, -- 15%
  bid_decrease_pct DECIMAL(4,3) DEFAULT 0.200, -- 20%
  max_bid DECIMAL(10,2) DEFAULT 10.00,
  min_bid DECIMAL(10,2) DEFAULT 0.50,

  -- Feature flags
  auto_pause_enabled BOOLEAN DEFAULT true,
  auto_bid_enabled BOOLEAN DEFAULT true,
  auto_expand_enabled BOOLEAN DEFAULT false, -- search term mining

  -- Lookback window for metrics
  metrics_lookback_days INT DEFAULT 14,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(product_id)
);

-- Subscription events sent from each product
CREATE TABLE asa_subscription_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES asa_products(id) ON DELETE CASCADE,

  -- Event data
  event_type TEXT NOT NULL, -- 'started', 'renewed', 'canceled', 'refunded'
  external_user_id TEXT NOT NULL, -- user ID from the product
  revenue DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',
  plan TEXT, -- 'weekly', 'monthly', 'yearly'

  -- Attribution data (from RevenueCat/product)
  network TEXT, -- 'apple_search_ads', 'organic', etc.
  campaign_id TEXT,
  campaign_name TEXT,
  ad_group_id TEXT,
  ad_group_name TEXT,
  keyword_id TEXT,
  keyword TEXT,
  match_type TEXT,

  -- Raw attribution JSON (for debugging)
  attribution_raw JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily keyword metrics pulled from ASA API
CREATE TABLE asa_keyword_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES asa_products(id) ON DELETE CASCADE,

  -- Identifiers from ASA
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  ad_group_id TEXT NOT NULL,
  ad_group_name TEXT NOT NULL,
  keyword_id TEXT NOT NULL,
  keyword_text TEXT NOT NULL,
  match_type TEXT NOT NULL, -- 'EXACT', 'BROAD'

  -- Daily metrics
  date DATE NOT NULL,
  impressions INT DEFAULT 0,
  taps INT DEFAULT 0,
  installs INT DEFAULT 0,
  new_downloads INT DEFAULT 0,
  redownloads INT DEFAULT 0,
  spend DECIMAL(10,2) DEFAULT 0,
  avg_cpt DECIMAL(10,2) DEFAULT 0,
  avg_cpa DECIMAL(10,2) DEFAULT 0,
  ttr DECIMAL(6,5) DEFAULT 0, -- tap-through rate

  -- Current state
  bid_amount DECIMAL(10,2),
  status TEXT, -- 'ACTIVE', 'PAUSED'

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(product_id, keyword_id, date)
);

-- Calculated LTV metrics per keyword (updated by optimizer)
CREATE TABLE asa_keyword_ltv (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES asa_products(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL,
  keyword_text TEXT,
  campaign_name TEXT,

  -- Aggregated metrics (rolling window)
  total_taps INT DEFAULT 0,
  total_installs INT DEFAULT 0,
  total_spend DECIMAL(10,2) DEFAULT 0,

  -- Subscription metrics
  total_subscribers INT DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,

  -- Calculated metrics
  cpi DECIMAL(10,2), -- cost per install
  install_to_sub_rate DECIMAL(5,4) DEFAULT 0,
  cost_per_subscriber DECIMAL(10,2),
  ltv_estimate DECIMAL(10,2),
  roas DECIMAL(6,3), -- revenue / spend

  -- Current bid info (cached from latest metrics)
  current_bid DECIMAL(10,2),
  current_status TEXT,

  last_calculated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(product_id, keyword_id)
);

-- Audit log of all automation changes
CREATE TABLE asa_automation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES asa_products(id) ON DELETE CASCADE,

  -- What changed
  campaign_id TEXT,
  campaign_name TEXT,
  ad_group_id TEXT,
  keyword_id TEXT NOT NULL,
  keyword_text TEXT NOT NULL,

  -- Change details
  action TEXT NOT NULL, -- 'PAUSE', 'ACTIVATE', 'BID_INCREASE', 'BID_DECREASE', 'CREATE'
  old_value TEXT,
  new_value TEXT,

  -- Why it changed
  reason TEXT NOT NULL,
  metrics_snapshot JSONB, -- metrics at time of decision

  -- Execution status
  applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,
  error_message TEXT,

  -- For manual review/revert
  reverted BOOLEAN DEFAULT false,
  reverted_at TIMESTAMPTZ,
  reverted_by TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Optimization run history
CREATE TABLE asa_optimization_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES asa_products(id) ON DELETE CASCADE,

  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  -- Results
  status TEXT DEFAULT 'running', -- 'running', 'completed', 'failed'
  keywords_evaluated INT DEFAULT 0,
  changes_made INT DEFAULT 0,
  changes_applied INT DEFAULT 0,
  changes_failed INT DEFAULT 0,

  -- Error info
  error_message TEXT,

  -- Summary
  summary JSONB -- { paused: 2, bid_increased: 5, bid_decreased: 3 }
);

-- Indexes for performance
CREATE INDEX idx_asa_products_bundle ON asa_products(bundle_id);
CREATE INDEX idx_asa_products_api_key ON asa_products(api_key);

CREATE INDEX idx_asa_events_product ON asa_subscription_events(product_id);
CREATE INDEX idx_asa_events_keyword ON asa_subscription_events(keyword_id);
CREATE INDEX idx_asa_events_created ON asa_subscription_events(created_at);

CREATE INDEX idx_asa_metrics_product_date ON asa_keyword_metrics(product_id, date DESC);
CREATE INDEX idx_asa_metrics_keyword ON asa_keyword_metrics(keyword_id, date DESC);

CREATE INDEX idx_asa_ltv_product ON asa_keyword_ltv(product_id);
CREATE INDEX idx_asa_ltv_keyword ON asa_keyword_ltv(keyword_id);

CREATE INDEX idx_asa_log_product ON asa_automation_log(product_id);
CREATE INDEX idx_asa_log_created ON asa_automation_log(created_at DESC);
CREATE INDEX idx_asa_log_keyword ON asa_automation_log(keyword_id);

CREATE INDEX idx_asa_runs_product ON asa_optimization_runs(product_id);
CREATE INDEX idx_asa_runs_started ON asa_optimization_runs(started_at DESC);

-- Function to aggregate keyword metrics for a product
CREATE OR REPLACE FUNCTION get_keyword_aggregates(
  p_product_id UUID,
  p_lookback_days INT DEFAULT 14
)
RETURNS TABLE (
  keyword_id TEXT,
  keyword_text TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  ad_group_id TEXT,
  ad_group_name TEXT,
  match_type TEXT,
  current_status TEXT,
  current_bid DECIMAL,
  total_taps BIGINT,
  total_installs BIGINT,
  total_spend DECIMAL,
  avg_ttr DECIMAL,
  cpi DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.keyword_id,
    m.keyword_text,
    m.campaign_id,
    m.campaign_name,
    m.ad_group_id,
    m.ad_group_name,
    m.match_type,
    -- Get most recent status/bid
    (SELECT km.status FROM asa_keyword_metrics km
     WHERE km.product_id = p_product_id AND km.keyword_id = m.keyword_id
     ORDER BY km.date DESC LIMIT 1) as current_status,
    (SELECT km.bid_amount FROM asa_keyword_metrics km
     WHERE km.product_id = p_product_id AND km.keyword_id = m.keyword_id
     ORDER BY km.date DESC LIMIT 1) as current_bid,
    -- Aggregates
    SUM(m.taps)::BIGINT as total_taps,
    SUM(m.installs)::BIGINT as total_installs,
    SUM(m.spend) as total_spend,
    AVG(m.ttr) as avg_ttr,
    CASE WHEN SUM(m.installs) > 0
         THEN SUM(m.spend) / SUM(m.installs)
         ELSE NULL END as cpi
  FROM asa_keyword_metrics m
  WHERE m.product_id = p_product_id
    AND m.date >= CURRENT_DATE - (p_lookback_days || ' days')::INTERVAL
  GROUP BY m.keyword_id, m.keyword_text, m.campaign_id, m.campaign_name,
           m.ad_group_id, m.ad_group_name, m.match_type;
END;
$$ LANGUAGE plpgsql;

-- Function to count subscribers per keyword
CREATE OR REPLACE FUNCTION get_keyword_subscribers(
  p_product_id UUID,
  p_keyword_id TEXT
)
RETURNS TABLE (
  subscriber_count BIGINT,
  total_revenue DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(DISTINCT e.external_user_id)::BIGINT as subscriber_count,
    COALESCE(SUM(e.revenue), 0) as total_revenue
  FROM asa_subscription_events e
  WHERE e.product_id = p_product_id
    AND e.keyword_id = p_keyword_id
    AND e.event_type IN ('started', 'renewed');
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on products
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asa_products_updated_at
  BEFORE UPDATE ON asa_products
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER asa_product_configs_updated_at
  BEFORE UPDATE ON asa_product_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
