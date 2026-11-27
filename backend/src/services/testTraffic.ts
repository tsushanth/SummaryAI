/**
 * Which accounts and requests are ours or automated, so that counts and alerts only see people. The rule lives in the
 * database (migration 039: public.test_account_reason and test_traffic_rules), because the list of our own addresses must
 * not be in this public repository. This module only asks it. See docs/TEST_TRAFFIC.md.
 */
import { supabaseAdmin } from '../lib/supabase.js';

/**
 * Used only when the database cannot answer (migration 039 not applied yet, or the call failed): the patterns that are
 * automated by construction. No address of ours, so owner accounts count until the database answers.
 */
export const TEST_ACCOUNT_RE = /@example\.(com|org|net)$|@cloudtestlabaccounts\.com$|\.[0-9]{5}@gmail\.com$|\+mmsynth[a-z0-9]*@/i;

/** The fallback reads one account per call, so it is bounded. */
const FALLBACK_MAX_LOOKUPS = 200;

/** The ids among `userIds` that are not people to count. Never throws; an account that cannot be read counts as a person. */
export async function testAccountsAmong(userIds: Array<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Set();
  try {
    const { data, error } = await supabaseAdmin.rpc('test_accounts_among', { p_users: ids });
    if (!error && Array.isArray(data)) return new Set((data as Array<{ user_id: string }>).map((r) => r.user_id));
  } catch { /* fall through to the patterns */ }
  const found = new Set<string>();
  for (const id of ids.slice(0, FALLBACK_MAX_LOOKUPS)) {
    try {
      const account = await supabaseAdmin.auth.admin.getUserById(id);
      if (TEST_ACCOUNT_RE.test(account?.data?.user?.email ?? '')) found.add(id);
    } catch { /* unreadable: counts as a person */ }
  }
  return found;
}

export async function isTestAccount(userId: string): Promise<boolean> {
  return (await testAccountsAmong([userId])).has(userId);
}

/**
 * Tools that no person browses with: headless browsers, crawlers that run scripts, and command-line clients (our deploy
 * checks). Matched on whole product names, so a phone brand containing "bot" is not caught. The user agent is only
 * looked at, never stored.
 */
const AUTOMATED_UA_RE = /HeadlessChrome|Chrome-Lighthouse|Googlebot|Google-InspectionTool|AdsBot-Google|Mediapartners-Google|Google Page Speed|bingbot|BingPreview|facebookexternalhit|AhrefsBot|SemrushBot|PetalBot|YandexBot|Applebot|DuckDuckBot|GPTBot|ClaudeBot|Bytespider|PhantomJS|^(curl|Wget|python-requests|Python-urllib)\//i;

export const isAutomatedUserAgent = (userAgent: string | null | undefined): boolean => AUTOMATED_UA_RE.test(userAgent ?? '');
