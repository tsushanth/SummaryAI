/**
 * Who is shown phone calls. The server decides, from the account switches (config/featureFlags.ts), the countries in
 * server config and what the app says about the device. In this order:
 *
 *   1. The account does not have the feature (switch off and not a tester): hidden.
 *   2. Tester account: shown.
 *   3. The app sent no country at all (every released version up to now): hidden.
 *   4. SIM country or network country is supported: shown. The device region counts only when the app has neither.
 *   5. The account already verified a number: shown, wherever it is.
 *
 * This only decides what is shown. The device's countries are its own claim; which numbers can be verified or called is
 * enforced separately (phone/numbers.ts and the carrier settings), and changing the list here does not change that.
 *
 *   PHONE_COUNTRIES   Comma separated two-letter countries. Unset or blank: US,CA. Set to anything without a valid
 *                     code (for example "none"): no country, leaving testers and accounts with a verified number.
 */
import { hasPhoneCalls, isPhoneTester } from '../config/featureFlags.js';

type Env = Record<string, string | undefined>;

export const DEFAULT_PHONE_COUNTRIES: readonly string[] = ['US', 'CA'];

/** Request headers the app sends on /api/phone. Two-letter country codes only. */
export const SIM_COUNTRY_HEADER = 'x-mm-sim-country';
export const NETWORK_COUNTRY_HEADER = 'x-mm-network-country';
export const DEVICE_REGION_HEADER = 'x-mm-device-region';
/** "1" from our own debug builds and Firebase Test Lab, which are not counted as people. */
export const TEST_DEVICE_HEADER = 'x-mm-test';

const asCountry = (v: unknown): string | undefined =>
  typeof v === 'string' && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : undefined;

export function phoneCountries(env: Env = process.env): readonly string[] {
  const raw = String(env.PHONE_COUNTRIES ?? '').trim();
  if (!raw) return DEFAULT_PHONE_COUNTRIES;
  return raw.split(',').map(asCountry).filter((c): c is string => !!c);
}

export interface ClientCountries { sim?: string; network?: string; region?: string }

export function readClientCountries(header: (name: string) => string | undefined): ClientCountries {
  return {
    sim: asCountry(header(SIM_COUNTRY_HEADER)),
    network: asCountry(header(NETWORK_COUNTRY_HEADER)),
    region: asCountry(header(DEVICE_REGION_HEADER)),
  };
}

/** The countries that speak for where the person is: SIM and network, else the device region. */
const spokenFor = (c: ClientCountries): string[] => {
  const mobile = [c.sim, c.network].filter((x): x is string => !!x);
  if (mobile.length) return mobile;
  return c.region ? [c.region] : [];
};

export interface Visibility {
  via: 'tester' | 'country' | 'verified';
  /** The country usage is counted under: the supported one that showed the feature, else the first the app sent. */
  country?: string;
}

/**
 * Null when this person does not see phone calls. `hasVerifiedNumber` is asked only when nothing else decides it, so
 * a request that is hidden for lack of a switch or of any country reads nothing.
 */
export async function phoneVisibility(
  userId: string,
  client: ClientCountries,
  hasVerifiedNumber: () => Promise<boolean>,
  env: Env = process.env,
): Promise<Visibility | null> {
  if (!hasPhoneCalls(userId, env)) return null;
  const mine = spokenFor(client);
  const supported = phoneCountries(env);
  const here = mine.find((c) => supported.includes(c));
  if (isPhoneTester(userId, env)) return { via: 'tester', country: here ?? mine[0] };
  if (!mine.length) return null;
  if (here) return { via: 'country', country: here };
  return (await hasVerifiedNumber()) ? { via: 'verified', country: mine[0] } : null;
}
