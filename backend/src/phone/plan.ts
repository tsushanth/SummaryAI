/**
 * The personal-number plan: server configuration, read at request time. Purchase is off unless PHONE_PURCHASE_ENABLED is
 * an explicit yes AND a product id is set. Included amounts are bounded here and again by the database.
 *
 *   PHONE_PURCHASE_ENABLED    off by default
 *   PHONE_PLAN_PRODUCT_ID     Google Play subscription product id
 *   PHONE_PLAN_PRICE_LABEL    shown only if the app cannot read the price from Google Play
 *   PHONE_PLAN_CALL_MINUTES   included call minutes per period (default 100, at most 300)
 *   PHONE_PLAN_AGENT_MINUTES  included agent minutes per period (default 30, at most 90)
 */
export interface PhonePlan {
  purchaseEnabled: boolean;
  productId: string;
  priceLabel: string;
  callMinutes: number;
  agentMinutes: number;
}

const bounded = (v: string | undefined, fallback: number, max: number): number => {
  const n = Number(v);
  return v !== undefined && Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
};

export function readPhonePlan(env: Record<string, string | undefined> = process.env): PhonePlan {
  const productId = env.PHONE_PLAN_PRODUCT_ID?.trim() ?? '';
  return {
    purchaseEnabled: !!productId && ['1', 'true', 'on', 'yes'].includes(String(env.PHONE_PURCHASE_ENABLED ?? '').trim().toLowerCase()),
    productId,
    priceLabel: env.PHONE_PLAN_PRICE_LABEL?.trim() ?? '',
    callMinutes: bounded(env.PHONE_PLAN_CALL_MINUTES, 100, 300),
    agentMinutes: bounded(env.PHONE_PLAN_AGENT_MINUTES, 30, 90),
  };
}

/**
 * The free trial of an own number with an agent. Off unless PHONE_AGENT_TRIAL is an explicit yes. This only switches it on
 * or off: how many people, how long and how much agent time are fixed in the database (phone_trial_limits()).
 */
export const readAgentTrial = (env: Record<string, string | undefined> = process.env): boolean =>
  ['1', 'true', 'on', 'yes'].includes(String(env.PHONE_AGENT_TRIAL ?? '').trim().toLowerCase());
