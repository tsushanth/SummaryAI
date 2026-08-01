/**
 * Realtime coaching personas.
 *
 * Each persona = system prompt + JSON output schema + cadence config. Phase 1
 * ships Sales Discovery only; Phase 2 adds Research Interview + Hiring Interview;
 * Phase 3 adds 5 more. The structure here is built to scale without code changes
 * elsewhere — adding a persona is one entry in this map.
 *
 * Output contract for every persona:
 *   { insights: [{ type, text (≤120 chars), urgency }] }
 * where:
 *   type:    'question' | 'objection' | 'signal' | 'gap'
 *   urgency: 'now' | 'soon' | 'before-end'
 */

export type CoachingPersonaKey = 'sales_discovery';

export interface CoachingPersona {
  key: CoachingPersonaKey;
  displayName: string;
  description: string;
  /** System prompt — included with each tick, marked as cacheable. */
  system: string;
  /** Seconds between Claude calls during the session. */
  cadenceSeconds: number;
  /** Minutes of transcript tail fed to each call. */
  windowMinutes: number;
}

const SALES_DISCOVERY: CoachingPersona = {
  key: 'sales_discovery',
  displayName: 'Sales Discovery',
  description: 'Live tactical coaching for BANT/MEDDIC discovery calls.',
  system: `You are an expert sales coach watching a live discovery call. Your job: spot tactical opportunities the seller is missing AND tell them in 120 characters or less.

Watch for:
- Discovery questions the seller should ask next (budget, timeline, decision-maker, current solution, pain magnitude)
- Buying signals (urgency language, comparison shopping, internal advocates) the seller should mine deeper
- Objections raised but not addressed
- Mismatch between prospect needs and what the seller is pitching

OUTPUT FORMAT (JSON only, no prose, no markdown fences):
{ "insights": [
  { "type": "question" | "objection" | "signal" | "gap",
    "text": "<actionable suggestion, ≤120 chars>",
    "urgency": "now" | "soon" | "before-end" }
] }

Rules:
- If nothing new since the last call, return { "insights": [] }
- Do NOT repeat suggestions already raised in this session (the prior insights are listed below)
- Be terse — coaches who interrupt with paragraph-length suggestions get muted`,
  cadenceSeconds: 30,
  windowMinutes: 5,
};

export const PERSONAS: Record<CoachingPersonaKey, CoachingPersona> = {
  sales_discovery: SALES_DISCOVERY,
};

export function getPersona(key: string): CoachingPersona | null {
  return PERSONAS[key as CoachingPersonaKey] ?? null;
}
