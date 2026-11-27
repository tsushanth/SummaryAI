/**
 * Client of the Calldesk partner API: an agent from one prompt, a one-call media stream for it, and the result.
 * MeetingMind keeps the numbers, the call, the recording, the notice and the money; Calldesk provides the agent.
 * Off unless CALLDESK_PARTNER_BASE_URL, CALLDESK_PARTNER_API_KEY and CALLDESK_PARTNER_WEBHOOK_SECRET are set.
 * Nothing sent or received is logged.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CalldeskSettings { baseUrl: string; apiKey: string; webhookSecret: string }

export function readCalldeskSettings(env: Record<string, string | undefined> = process.env): CalldeskSettings | null {
  const s = {
    baseUrl: (env.CALLDESK_PARTNER_BASE_URL?.trim() ?? '').replace(/\/+$/, ''),
    apiKey: env.CALLDESK_PARTNER_API_KEY?.trim() ?? '',
    webhookSecret: env.CALLDESK_PARTNER_WEBHOOK_SECRET?.trim() ?? '',
  };
  return s.baseUrl.startsWith('https://') && s.apiKey && s.webhookSecret.length >= 32 ? s : null;
}

export interface Agent { agentId: string; description: string; language: string; warnings: string[] }
export interface AgentSession { streamUrl: string; token: string; maxSeconds: number }
export interface AgentResult {
  external_call_id: string;
  external_user_id: string;
  agent_id: string;
  duration_seconds: number;
  ended_reason: string;
  outcome: string | null;
  language: string;
  transcript: { role: string; text: string }[];
  summary: string | null;
  analysis: unknown;
}

export class CalldeskError extends Error {
  constructor(public status: number, public code: string) {
    super(`calldesk ${status} ${code}`);
    this.name = 'CalldeskError';
  }
}

export interface CalldeskClient {
  languages(): Promise<{ code: string; name: string; level: string }[]>;
  createAgent(a: { userId: string; prompt: string; language: string; idempotencyKey: string }): Promise<Agent>;
  updateAgent(agentId: string, a: { userId: string; prompt: string; language: string }): Promise<Agent>;
  deleteAgent(agentId: string, userId: string): Promise<void>;
  attachNumber(userId: string, number: string, agentId: string): Promise<void>;
  createSession(a: { userId: string; agentId: string; callId: string; language: string; maxSeconds: number; remoteNumber: string }): Promise<AgentSession>;
  result(callId: string, userId: string): Promise<AgentResult | null>;
  deleteUser(userId: string): Promise<'deleted' | 'not_found'>;
}

/** Only the known fields, with bounded sizes. Null when it is not a result. */
export function cleanResult(raw: unknown): AgentResult | null {
  const r = raw as Record<string, unknown> | null;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (!r || typeof r.external_call_id !== 'string' || typeof r.external_user_id !== 'string' || typeof r.agent_id !== 'string') return null;
  const turns = Array.isArray(r.transcript) ? r.transcript.slice(0, 600) : [];
  const analysis = r.analysis && JSON.stringify(r.analysis).length <= 20_000 ? r.analysis : null;
  return {
    external_call_id: r.external_call_id,
    external_user_id: r.external_user_id,
    agent_id: r.agent_id,
    duration_seconds: Math.max(0, Math.round(Number(r.duration_seconds) || 0)),
    ended_reason: str(r.ended_reason, 40),
    outcome: str(r.outcome, 80) || null,
    language: str(r.language, 16),
    transcript: turns.map((t) => ({ role: (t as { role?: unknown })?.role === 'agent' ? 'agent' : 'caller', text: str((t as { text?: unknown })?.text, 2000) })),
    summary: str(r.summary, 4000) || null,
    analysis,
  };
}

/** `X-Calldesk-Signature: sha256=<hex HMAC(secret, timestamp + "." + rawBody)>`, timestamp at most 5 minutes off. */
export function verifyCalldeskSignature(secret: string, timestamp: string, signature: string, rawBody: Buffer | undefined, nowMs = Date.now()): boolean {
  const ts = Number(timestamp);
  if (!secret || !rawBody || !/^\d{9,11}$/.test(timestamp) || Math.abs(nowMs / 1000 - ts) > 300) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createCalldeskClient(s: CalldeskSettings, fetchImpl: typeof fetch = fetch): CalldeskClient {
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs = 10_000): Promise<any> => {
    let res: Response;
    try {
      res = await fetchImpl(`${s.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${s.apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new CalldeskError(0, 'unreachable');
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new CalldeskError(res.status, typeof json?.code === 'string' && /^[a-z_]{1,40}$/.test(json.code) ? json.code : 'error');
    return json;
  };
  const agent = (j: any): Agent => {
    if (typeof j?.agent_id !== 'string') throw new CalldeskError(502, 'bad_answer');
    return {
      agentId: j.agent_id, description: String(j.description ?? '').slice(0, 2000), language: String(j.language ?? ''),
      warnings: Array.isArray(j.warnings) ? j.warnings.slice(0, 10).map((w: any) => String(w?.message ?? '').slice(0, 300)) : [],
    };
  };
  const enc = encodeURIComponent;
  return {
    async languages() {
      const j = await call('GET', '/languages');
      return Array.isArray(j?.languages) ? j.languages.map((l: any) => ({ code: String(l.code), name: String(l.name), level: String(l.level) })) : [];
    },
    async createAgent(a) {
      return agent(await call('POST', '/agents', { external_user_id: a.userId, prompt: a.prompt, language: a.language, direction: 'inbound' }, { 'Idempotency-Key': a.idempotencyKey }, 90_000));
    },
    async updateAgent(agentId, a) {
      return agent(await call('PUT', `/agents/${enc(agentId)}`, { external_user_id: a.userId, prompt: a.prompt, language: a.language }, {}, 90_000));
    },
    async deleteAgent(agentId, userId) {
      try { await call('DELETE', `/agents/${enc(agentId)}?external_user_id=${enc(userId)}`); }
      catch (e) { if (!(e instanceof CalldeskError && e.status === 404)) throw e; }
    },
    async attachNumber(userId, number, agentId) { await call('PUT', `/users/${enc(userId)}/number`, { number, agent_id: agentId }); },
    async createSession(a) {
      // Short timeout: a caller is waiting on the line.
      const j = await call('POST', '/sessions', {
        external_user_id: a.userId, agent_id: a.agentId, external_call_id: a.callId, direction: 'inbound', language: a.language,
        max_seconds: a.maxSeconds, remote_number: a.remoteNumber,
      }, {}, 5_000);
      const token = j?.parameters?.token;
      const max = Number(j?.max_seconds);
      if (typeof j?.stream_url !== 'string' || !j.stream_url.startsWith('wss://') || typeof token !== 'string' || !(max > 0)) throw new CalldeskError(502, 'bad_answer');
      return { streamUrl: j.stream_url, token, maxSeconds: max };
    },
    async result(callId, userId) {
      try { return cleanResult(await call('GET', `/sessions/${enc(callId)}?external_user_id=${enc(userId)}`)); }
      catch (e) { if (e instanceof CalldeskError && e.status === 404) return null; throw e; }
    },
    async deleteUser(userId) {
      const j = await call('DELETE', `/users/${enc(userId)}`);
      return j?.deleted === false ? 'not_found' : 'deleted';
    },
  };
}
