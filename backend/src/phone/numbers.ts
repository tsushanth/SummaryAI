/**
 * Which phone numbers calls may use. Only United States and Canada geographic numbers, typed with their country code.
 * The server never adds a country code: "5125550100" is refused, not read as +1.
 */
import { createHmac } from 'node:crypto';
import { CA_AREA_CODES, US_AREA_CODES } from './areaCodes.js';

export type NumberProblem =
  | 'country_code_required' // no leading +
  | 'invalid_number'        // not a well-formed number
  | 'country_not_supported' // not +1, or a +1 area outside the United States and Canada
  | 'number_not_allowed';   // premium, special-rate or reserved range

export type ParsedNumber = { ok: true; e164: string; country: 'US' | 'CA' } | { ok: false; reason: NumberProblem };

/** Exchange codes (the three digits after the area code) that are premium, directory, carrier or test ranges. */
const SPECIAL_EXCHANGES = new Set(['555', '950', '958', '959', '976']);
/**
 * Common +1 area codes that are not geographic (toll-free, premium, personal communication and other special services).
 * Only chooses the message: what is allowed is decided by the geographic list in areaCodes.ts.
 */
const SPECIAL_AREA = /^(8(00|33|44|55|66|77|88)|900|5(00|2[1-9]|33|44|66|77|88)|700|710|600|622|456|[2-9]11)$/;

export function parsePhoneNumber(input: unknown): ParsedNumber {
  if (typeof input !== 'string' || input.length > 32) return { ok: false, reason: 'invalid_number' };
  // Spaces and the usual punctuation are accepted; anything else (letters, extensions, pause characters) is not.
  if (!/^[\s()+\-.\d]*$/.test(input)) return { ok: false, reason: 'invalid_number' };
  const compact = input.replace(/[\s()\-.]/g, '');
  if (!compact.startsWith('+')) return { ok: false, reason: compact ? 'country_code_required' : 'invalid_number' };
  if (!/^\+[1-9]\d{6,14}$/.test(compact)) return { ok: false, reason: 'invalid_number' };
  if (!compact.startsWith('+1')) return { ok: false, reason: 'country_not_supported' };
  if (compact.length !== 12) return { ok: false, reason: 'invalid_number' };
  const area = compact.slice(2, 5);
  const exchange = compact.slice(5, 8);
  const country = US_AREA_CODES.has(area) ? 'US' : CA_AREA_CODES.has(area) ? 'CA' : null;
  if (!country) return { ok: false, reason: SPECIAL_AREA.test(area) ? 'number_not_allowed' : 'country_not_supported' };
  if (!/^[2-9]\d\d$/.test(exchange) || /^[2-9]11$/.test(exchange)) return { ok: false, reason: 'invalid_number' };
  if (SPECIAL_EXCHANGES.has(exchange)) return { ok: false, reason: 'number_not_allowed' };
  return { ok: true, e164: compact, country };
}

/** Keyed hash used in the ledger and in rate limits, so those never need the number itself. */
export function hashNumber(e164: string, key: string): string {
  if (!key) throw new Error('number hash key missing');
  return createHmac('sha256', key).update(e164).digest('hex');
}
