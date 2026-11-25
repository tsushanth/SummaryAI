/** An OAuth token request the provider refused. `providerCode` is the provider's error code only: no description, ids or tokens. */
export class OAuthExchangeError extends Error {
  providerCode: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.providerCode = oauthProviderCode(status, body);
  }
}

const safe = (v: unknown): string => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60) : '');

/** "invalid_grant", "invalid_client AADSTS7000222", or "HTTP_502" when the body is not an OAuth error. */
export function oauthProviderCode(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: unknown; error_codes?: unknown };
    const code = safe(j.error);
    if (!code) return `HTTP_${status}`;
    const aad = Array.isArray(j.error_codes) && Number.isInteger(j.error_codes[0]) ? ` AADSTS${j.error_codes[0]}` : '';
    return `${code}${aad}`;
  } catch {
    return `HTTP_${status}`;
  }
}

/** The error code a provider put on the callback URL, plus Microsoft's AADSTS number when its description carries one. */
export function callbackProviderCode(error: unknown, description?: unknown): string {
  const aad = typeof description === 'string' ? description.match(/AADSTS\d+/)?.[0] : undefined;
  return [safe(Array.isArray(error) ? error[0] : error) || 'unknown', aad].filter(Boolean).join(' ');
}
