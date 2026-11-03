import type { SessionConfig } from './session.js';

export interface ServiceConfig {
  port: number;
  /** Secrets accepted for ingest tokens (current first; list the previous one during rotation). */
  ingestSecrets: string[];
  sonioxApiKey: string;
  sonioxModel: string;
  sonioxUrl: string | undefined;
  sonioxAuthMode: 'header' | 'config' | 'both';
  /** Max simultaneous Soniox streams opened by this service. The Soniox account is shared with other products. */
  maxStreams: number;
  sonioxEndpointDetection: boolean;
  sonioxEndpointMaxDelayMs: number | undefined;
  maxSessions: number;
  sink: 'http' | 'supabase' | 'log';
  backendSinkUrl: string | undefined;
  backendSinkSecret: string | undefined;
  supabaseUrl: string | undefined;
  supabaseServiceKey: string | undefined;
  adminToken: string | undefined;
  alertWebhookUrl: string | undefined;
  /** Trust Fly's client IP header for rate limiting. */
  trustFlyProxy: boolean;
  /** How long a session survives without a Recall socket (Recall retries every 3 s for 30 attempts). */
  recallGraceMs: number;
  session: Partial<SessionConfig>;
}

function int(v: string | undefined, d: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Reads env only. Throws a message that names the missing variable (never its value). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  const sink = (env.SINK ?? 'http') as ServiceConfig['sink'];
  if (!['http', 'supabase', 'log'].includes(sink)) throw new Error('SINK must be http, supabase or log');
  const ingestSecrets = (env.INGEST_TOKEN_SECRETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ingestSecrets.length === 0) throw new Error('INGEST_TOKEN_SECRETS is required');
  if (!env.SONIOX_API_KEY) throw new Error('SONIOX_API_KEY is required');
  if (sink === 'http' && (!env.BACKEND_SINK_URL || !env.BACKEND_SINK_SECRET)) throw new Error('BACKEND_SINK_URL and BACKEND_SINK_SECRET are required for SINK=http');
  if (sink === 'supabase' && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY)) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required for SINK=supabase');
  const authMode = (env.SONIOX_AUTH_MODE ?? 'header') as ServiceConfig['sonioxAuthMode'];
  return {
    port: int(env.PORT, 8080),
    ingestSecrets,
    sonioxApiKey: env.SONIOX_API_KEY,
    sonioxModel: env.SONIOX_MODEL ?? 'stt-rt-v6',
    sonioxUrl: env.SONIOX_URL || undefined,
    sonioxAuthMode: ['header', 'config', 'both'].includes(authMode) ? authMode : 'header',
    maxStreams: Math.max(1, int(env.MAX_SONIOX_STREAMS, 3)),
    sonioxEndpointDetection: env.SONIOX_ENDPOINT_DETECTION !== '0',
    sonioxEndpointMaxDelayMs: env.SONIOX_ENDPOINT_MAX_DELAY_MS ? int(env.SONIOX_ENDPOINT_MAX_DELAY_MS, 2000) : undefined,
    maxSessions: Math.max(1, int(env.MAX_SESSIONS, Math.max(1, int(env.MAX_SONIOX_STREAMS, 3)))),
    sink,
    backendSinkUrl: env.BACKEND_SINK_URL,
    backendSinkSecret: env.BACKEND_SINK_SECRET,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY,
    adminToken: env.ADMIN_TOKEN || undefined,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL || undefined,
    trustFlyProxy: env.TRUST_FLY_PROXY !== '0',
    recallGraceMs: int(env.RECALL_GRACE_MS, 120_000),
    session: {
      languageHints: (env.LANGUAGE_HINTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    },
  };
}
