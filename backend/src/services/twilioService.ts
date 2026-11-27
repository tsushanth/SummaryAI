/**
 * Removes what the carrier still holds for an account that is being deleted. Calling itself lives in src/phone.
 *
 * A reference is one of:
 *   RE...             a recording made by the old phone feature on the main Twilio account
 *   phone:RE...       a recording on the calls subaccount
 *   phonecall:CA...   every recording of one call on the calls subaccount
 *   callerid:PN...    a verified caller ID (the user's own number) on the calls subaccount
 */

import Twilio from 'twilio';
import { config } from '../config/index.js';
import { readPhoneSettings } from '../phone/settings.js';
import { createTwilioGateway } from '../phone/gateway.js';

export class TwilioService {
  private static client: Twilio.Twilio | null = null;

  private static getClient(): Twilio.Twilio {
    if (!this.client) {
      if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) throw new Error('Twilio credentials not configured');
      this.client = new Twilio.Twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
    }
    return this.client;
  }

  /** Throws when the thing could not be deleted (the purge then retries); resolves 'not_found' when it is already gone. */
  static async deleteReference(ref: string): Promise<'deleted' | 'not_found'> {
    const [kind, sid] = ref.includes(':') ? (ref.split(':', 2) as [string, string]) : ['main', ref];
    if (kind === 'main') {
      try {
        await this.getClient().recordings(sid).remove();
        return 'deleted';
      } catch (err) {
        const e = err as { status?: number; code?: number };
        if (e?.status === 404 || e?.code === 20404) return 'not_found';
        throw err;
      }
    }
    const settings = readPhoneSettings();
    if (!settings) throw new Error('calls subaccount not configured');
    const gateway = createTwilioGateway(settings);
    if (kind === 'phone') return gateway.deleteRecording(sid);
    if (kind === 'callerid') return gateway.deleteCallerId(sid);
    if (kind === 'phonecall') {
      let result: 'deleted' | 'not_found' = 'not_found';
      for (const r of await gateway.listRecordings(sid)) {
        if ((await gateway.deleteRecording(r.sid)) === 'deleted') result = 'deleted';
      }
      return result;
    }
    throw new Error('unknown carrier reference');
  }
}
