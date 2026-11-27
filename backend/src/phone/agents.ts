/** The agent on a personal number: created from one prompt, and what it reports after a call. Inbound only. */
import { PhoneError, type PhoneDeps, type PhoneExtras } from './deps.js';
import { CalldeskError, cleanResult, type AgentResult, type CalldeskClient } from './calldesk.js';
import { isLive, sha256 } from './provision.js';
import { isUuid } from './calls.js';
import type { NumberRow } from './numbersStore.js';

const need = (x: PhoneExtras): CalldeskClient => {
  if (!x.calldesk) throw new PhoneError(503, 'PHONE_AGENT_UNAVAILABLE', 'Agents are not available right now.');
  return x.calldesk;
};

async function ownNumber(d: PhoneDeps, x: PhoneExtras, userId: string): Promise<NumberRow> {
  const number = await x.numbers.personalNumber(userId);
  if (number?.status !== 'active' || !isLive(await x.numbers.subscription(userId), d.now())) {
    throw new PhoneError(403, 'PHONE_NUMBER_REQUIRED', 'An agent needs your own number.');
  }
  return number;
}

const refusal = (e: unknown): PhoneError => {
  if (e instanceof CalldeskError) {
    if (e.code === 'prompt_not_allowed') return new PhoneError(422, 'PHONE_AGENT_PROMPT_NOT_ALLOWED', 'This description is not allowed.');
    if (e.code === 'unsupported_language') return new PhoneError(422, 'PHONE_AGENT_LANGUAGE', 'The agent does not speak this language yet.');
    if (e.status === 429) return new PhoneError(429, 'PHONE_AGENT_LIMIT', 'No more agents can be set up right now. Try again later.');
  }
  return new PhoneError(502, 'PHONE_AGENT_FAILED', 'The agent could not be set up. Try again.');
};

export async function setAgent(d: PhoneDeps, x: PhoneExtras, userId: string, input: { prompt?: unknown; language?: unknown }): Promise<{ description: string; language: string; warnings: string[] }> {
  const client = need(x);
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (prompt.length < 10 || prompt.length > 2000) throw new PhoneError(400, 'PHONE_AGENT_PROMPT_LENGTH', 'Describe what the agent should do in 10 to 2000 characters.');
  const language = typeof input.language === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(input.language) ? input.language : 'en';
  const number = await ownNumber(d, x, userId);
  // Making or changing an agent costs money: booked first.
  const booked = await x.numbers.reserveDraft(userId);
  if (booked.ok === false) {
    if (booked.reason === 'budget_used') { await d.track('cap_hit', userId, { cap: 'agent_budget' }); d.alert('BUDGET_CAP_HIT', { at: 'agent' }); }
    throw new PhoneError(429, booked.reason === 'budget_used' ? 'PHONE_BUDGET_USED' : 'PHONE_AGENT_LIMIT', 'No more agent changes are possible right now.');
  }
  const isNew = !number.agent_id;
  try {
    const agent = number.agent_id
      ? await client.updateAgent(number.agent_id, { userId, prompt, language })
      : await client.createAgent({ userId, prompt, language, idempotencyKey: sha256(`${userId}\n${language}\n${prompt}`) });
    await client.attachNumber(userId, number.phone_number!, agent.agentId);
    await x.numbers.updateNumber(number.id, { agent_id: agent.agentId, agent_language: agent.language || language, agent_description: agent.description });
    if (isNew) await d.track('agent_created', userId, { language });
    return { description: agent.description, language: agent.language || language, warnings: agent.warnings };
  } catch (e) {
    d.alert('AGENT_SETUP_FAILED', { code: e instanceof CalldeskError ? e.code : 'error' });
    throw refusal(e);
  }
}

export async function removeAgent(d: PhoneDeps, x: PhoneExtras, userId: string): Promise<void> {
  const number = await x.numbers.personalNumber(userId);
  if (!number?.agent_id) return;
  try { await need(x).deleteAgent(number.agent_id, userId); }
  catch (e) { d.alert('AGENT_DELETE_FAILED'); throw refusal(e); }
  await x.numbers.updateNumber(number.id, { agent_id: null, agent_language: null, agent_description: null });
}

/** Stores a result only on the call it belongs to: our id, the same account and the same agent. */
export async function storeAgentResult(d: PhoneDeps, x: PhoneExtras, raw: unknown): Promise<boolean> {
  const result: AgentResult | null = cleanResult(raw);
  if (!result || !isUuid(result.external_call_id)) return false;
  const call = await d.store.getCall(result.external_call_id);
  const agentId = (call as { agent_id?: string | null } | null)?.agent_id;
  if (!call || call.user_id !== result.external_user_id || !agentId || agentId !== result.agent_id) {
    d.alert('AGENT_RESULT_UNMATCHED');
    return false;
  }
  await x.numbers.saveAgentResult(call.id, result);
  return true;
}

/** Fetches results whose delivery was lost. */
export async function reconcileAgentResults(d: PhoneDeps, x: PhoneExtras): Promise<void> {
  if (!x.calldesk) return;
  const since = new Date(d.now() - 48 * 3600_000).toISOString();
  const before = new Date(d.now() - 3 * 60_000).toISOString();
  for (const c of await x.numbers.agentCallsWithoutResult(since, before)) {
    try {
      const result = await x.calldesk.result(c.id, c.user_id);
      if (result) await storeAgentResult(d, x, result);
      else if (d.now() - Date.parse(c.created_at) > 3600_000) d.alert('AGENT_RESULT_MISSING');
    } catch { d.alert('AGENT_RESULT_FETCH_FAILED'); }
  }
}
