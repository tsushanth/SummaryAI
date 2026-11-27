/**
 * Settings of the calls subaccount. MeetingMind calls run in their own Twilio subaccount, which keeps the numbers users
 * verify, the calls, the recordings and the spend of this feature together and apart from everything else.
 * All of these are required; if any is missing, phone calls are unavailable to everyone.
 *
 *   PHONE_TWILIO_ACCOUNT_SID, PHONE_TWILIO_AUTH_TOKEN     the subaccount (the token also verifies its webhooks)
 *   PHONE_TWILIO_API_KEY_SID, PHONE_TWILIO_API_KEY_SECRET  signs the short-lived app calling tokens
 *   PHONE_TWILIO_TWIML_APP_SID                             points the app's calls at /v1/webhooks/twilio/voip-outbound
 *   PHONE_NUMBER_HASH_KEY                                  keys the number hashes in the ledger
 *   SERVICE_URL                                            public base URL of this service
 */
export interface PhoneSettings {
  accountSid: string;
  authToken: string;
  apiKeySid: string;
  apiKeySecret: string;
  twimlAppSid: string;
  numberHashKey: string;
  publicBaseUrl: string;
}

export function readPhoneSettings(env: Record<string, string | undefined> = process.env): PhoneSettings | null {
  const s: PhoneSettings = {
    accountSid: env.PHONE_TWILIO_ACCOUNT_SID?.trim() ?? '',
    authToken: env.PHONE_TWILIO_AUTH_TOKEN?.trim() ?? '',
    apiKeySid: env.PHONE_TWILIO_API_KEY_SID?.trim() ?? '',
    apiKeySecret: env.PHONE_TWILIO_API_KEY_SECRET?.trim() ?? '',
    twimlAppSid: env.PHONE_TWILIO_TWIML_APP_SID?.trim() ?? '',
    numberHashKey: env.PHONE_NUMBER_HASH_KEY?.trim() ?? '',
    publicBaseUrl: (env.SERVICE_URL?.trim() ?? '').replace(/\/+$/, ''),
  };
  return Object.values(s).every(Boolean) ? s : null;
}

export const webhookUrl = (s: PhoneSettings, path: string): string => `${s.publicBaseUrl}/v1/webhooks/twilio/${path}`;
