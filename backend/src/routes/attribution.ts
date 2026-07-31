/**
 * Attribution routes — resolves Apple Search Ads AdServices tokens server-side
 * via Apple's resolver endpoint and stores the campaign/keyword breakdown so
 * later analytics can join ASA performance to in-app revenue.
 *
 * Unauthenticated: the iOS client calls this on first launch, before sign-in.
 */

import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

const APPLE_RESOLVER = 'https://api-adservices.apple.com/api/v1/';
// Whitelist of bundle IDs we'll resolve tokens for — prevents random callers
// from using our endpoint as a free Apple-API proxy.
const ALLOWED_BUNDLE_IDS = new Set([
  'com.kreativekoala.summaryai',
  'com.kreativekoala.meetingmind',
]);

interface AppleResolverResponse {
  attribution?: boolean;
  orgId?: number;
  campaignId?: number;
  adGroupId?: number;
  keywordId?: number;
  adId?: number;
  conversionType?: string;
  countryOrRegion?: string;
  clickDate?: string;
}

/**
 * POST /api/attribution/apple-search-ads
 *
 * Body: { token, bundleId, appVersion, platform }
 *
 * The token is sent as raw text to Apple's resolver; the resolved fields
 * (campaignId / keywordId / etc) are stored in asa_attribution_resolved.
 *
 * Returns 200 with { attribution: boolean } on success — even if Apple says
 * the install was organic, we return 200 (the call succeeded, it just wasn't
 * an ASA install). The client uses 200 as its "don't retry" signal.
 */
router.post('/apple-search-ads', async (req: Request, res: Response) => {
  const { token, bundleId, appVersion, platform } = req.body ?? {};

  if (typeof token !== 'string' || token.length < 10) {
    return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'token is required' } });
  }
  if (typeof bundleId !== 'string' || !ALLOWED_BUNDLE_IDS.has(bundleId)) {
    return res.status(400).json({ error: { code: 'INVALID_BUNDLE', message: 'bundleId not allowed' } });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Dedup: if we've already resolved this token, return cached result. This
  // matters because the client retries on transient failures, and Apple's
  // resolver is rate-limited.
  const { data: existing } = await supabaseAdmin
    .from('asa_attribution_resolved')
    .select('attribution, campaign_id, keyword_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (existing) {
    return res.status(200).json({
      attribution: existing.attribution ?? false,
      cached: true,
    });
  }

  // Resolve via Apple. Body must be the raw token string with Content-Type: text/plain.
  let resolverStatus = 0;
  let resolverError: string | null = null;
  let resolved: AppleResolverResponse = {};

  try {
    const r = await fetch(APPLE_RESOLVER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: token,
    });
    resolverStatus = r.status;
    const text = await r.text();
    if (r.ok) {
      try { resolved = JSON.parse(text) as AppleResolverResponse; } catch { resolverError = 'invalid-json'; }
    } else {
      // 404 → token not found yet (rare race condition); 400 → invalid token; 500s → Apple-side issue.
      resolverError = text.slice(0, 500) || `http_${r.status}`;
    }
  } catch (e) {
    resolverError = (e as Error).message;
  }

  // Always store, even on resolver failure — we want a record we tried, and
  // a row we can retry later if Apple was flaky.
  const { error: dbError } = await supabaseAdmin
    .from('asa_attribution_resolved')
    .insert({
      token_hash: tokenHash,
      bundle_id: bundleId,
      app_version: appVersion ?? null,
      platform: platform ?? 'ios',
      attribution: resolved.attribution ?? null,
      org_id: resolved.orgId ?? null,
      campaign_id: resolved.campaignId ?? null,
      ad_group_id: resolved.adGroupId ?? null,
      keyword_id: resolved.keywordId ?? null,
      ad_id: resolved.adId ?? null,
      conversion_type: resolved.conversionType ?? null,
      country_or_region: resolved.countryOrRegion ?? null,
      click_date: resolved.clickDate ?? null,
      raw_response: resolverStatus ? resolved : null,
      resolver_status: resolverStatus || null,
      resolver_error: resolverError,
    });

  if (dbError) {
    console.error('[Attribution] DB insert failed:', dbError.message);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'storage failed' } });
  }

  console.log(
    `[Attribution] resolved bundle=${bundleId} status=${resolverStatus} attribution=${resolved.attribution} ` +
    `campaign=${resolved.campaignId} keyword=${resolved.keywordId}`
  );

  return res.status(200).json({ attribution: resolved.attribution ?? false });
});

export default router;
