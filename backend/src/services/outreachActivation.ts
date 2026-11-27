import { supabaseAdmin } from '../lib/supabase.js';
import { outreachAttribution, reportActivationForUser, type ActivationLookups } from './outreachEvents.js';
import { isTestAccount } from './testTraffic.js';

/** Reads the first-touch attribution (signup_attribution) and the account email with the service role. */
export const activationLookups: ActivationLookups = {
  async getAttribution(userId) {
    const { data, error } = await supabaseAdmin
      .from('signup_attribution')
      .select('utm_source, utm_campaign')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data || (await isTestAccount(userId))) return null;
    return outreachAttribution(data as { utm_source?: string; utm_campaign?: string });
  },
  async getEmail(userId) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    return error ? null : (data?.user?.email ?? null);
  },
};

/** First recording completed for this user. Fire and forget; a no-op while OUTREACH_EVENTS_URL is unset. */
export function noteRecordingCompleted(userId: string | null | undefined): void {
  reportActivationForUser(userId, activationLookups);
}
