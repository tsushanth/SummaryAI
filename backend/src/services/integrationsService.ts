/**
 * Outbound integrations: signed webhook, Slack incoming webhook, Notion page.
 * All outbound HTTP goes through safeFetch (SSRF guard). Secrets are stored encrypted.
 */

import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { safeFetch, validateOutboundUrl, SsrfError, type SafeFetchOptions } from '../lib/ssrfGuard.js';
import { encryptToken, decryptToken } from './encryptionService.js';

export type IntegrationKind = 'webhook' | 'slack' | 'notion';
export const INTEGRATION_KINDS: IntegrationKind[] = ['webhook', 'slack', 'notion'];

export interface IntegrationRow {
  id: string;
  user_id: string;
  kind: IntegrationKind;
  enabled: boolean;
  url_encrypted: string | null;
  secret_encrypted: string | null;
  config: Record<string, any> | null;
  last_status: string | null;
  last_error: string | null;
  last_delivered_at: string | null;
}

export interface RecordingPayload {
  event: 'recording.completed' | 'test';
  recording: { id: string; title: string; duration_seconds?: number | null; created_at?: string | null };
  summary: string;
  key_points: string[];
  action_items: Array<{ text: string; assignee?: string | null; due_date?: string | null }>;
}

export interface DeliveryResult {
  ok: boolean;
  attempts: number;
  responseStatus?: number;
  error?: string;
}

export interface DeliverOptions {
  fetchImpl?: (url: string, o: SafeFetchOptions) => Promise<{ status: number; body: string }>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  now?: () => number;
}

const SLACK_HOSTS = ['hooks.slack.com'];
const NOTION_API = 'https://api.notion.com/v1/pages';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Throws SsrfError / Error when the user-supplied settings are unacceptable. */
export function validateIntegrationInput(
  kind: IntegrationKind,
  input: { url?: string; secret?: string; database_id?: string }
): void {
  if (kind === 'webhook') {
    if (!input.url) throw new Error('Webhook URL is required');
    validateOutboundUrl(input.url);
  } else if (kind === 'slack') {
    if (!input.url) throw new Error('Slack webhook URL is required');
    const { hostname } = validateOutboundUrl(input.url);
    if (!SLACK_HOSTS.includes(hostname)) throw new Error('Slack URL must be a hooks.slack.com incoming webhook');
  } else {
    if (!input.secret) throw new Error('Notion integration token is required');
    if (!input.database_id || !/^[0-9a-f-]{32,36}$/i.test(input.database_id)) {
      throw new Error('A valid Notion database id is required');
    }
  }
}

// ---------------------------------------------------------------------------
// Payload + signing
// ---------------------------------------------------------------------------

export function signWebhookBody(secret: string, timestamp: number, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function buildSlackMessage(p: RecordingPayload): { text: string; blocks: any[] } {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: clip(p.recording.title || 'Meeting', 150) } },
  ];
  if (p.summary) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip(p.summary, 2800) } });
  if (p.action_items.length) {
    const lines = p.action_items.slice(0, 10).map((a) => `• ${a.text}${a.assignee ? ` (${a.assignee})` : ''}`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: clip('*Action items*\n' + lines.join('\n'), 2800) } });
  }
  return { text: `${p.recording.title || 'Meeting'} summary`, blocks };
}

export function buildNotionPage(databaseId: string, p: RecordingPayload): Record<string, unknown> {
  const rt = (text: string) => [{ type: 'text', text: { content: text.slice(0, 2000) } }];
  const children: any[] = [];
  if (p.summary) children.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(p.summary) } });
  for (const k of p.key_points.slice(0, 20)) {
    children.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(k) } });
  }
  for (const a of p.action_items.slice(0, 20)) {
    children.push({ object: 'block', type: 'to_do', to_do: { checked: false, rich_text: rt(a.text) } });
  }
  return {
    parent: { database_id: databaseId },
    properties: { title: { title: [{ text: { content: (p.recording.title || 'Meeting').slice(0, 200) } }] } },
    children: children.slice(0, 100),
  };
}

// ---------------------------------------------------------------------------
// Delivery with retry
// ---------------------------------------------------------------------------

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

async function postWithRetry(
  url: string,
  headersFor: () => Record<string, string>,
  body: string,
  opts: DeliverOptions
): Promise<DeliveryResult> {
  const fetchImpl = opts.fetchImpl ?? ((u, o) => safeFetch(u, o));
  const sleep = opts.sleep ?? realSleep;
  const maxAttempts = opts.maxAttempts ?? 3;
  let lastError = '';
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(url, { method: 'POST', headers: headersFor(), body, timeoutMs: 10_000 });
      lastStatus = res.status;
      if (res.status >= 200 && res.status < 300) return { ok: true, attempts: attempt, responseStatus: res.status };
      lastError = `HTTP ${res.status}`;
      if (!isRetryable(res.status)) return { ok: false, attempts: attempt, responseStatus: res.status, error: lastError };
    } catch (e) {
      // SSRF violations are permanent; network errors are retried.
      if (e instanceof SsrfError) return { ok: false, attempts: attempt, error: e.message };
      lastError = e instanceof Error ? e.message : 'Request failed';
    }
    if (attempt < maxAttempts) await sleep(500 * 2 ** (attempt - 1));
  }
  return { ok: false, attempts: maxAttempts, responseStatus: lastStatus, error: lastError };
}

export async function deliverToIntegration(
  kind: IntegrationKind,
  creds: { url?: string | null; secret?: string | null; config?: Record<string, any> | null },
  payload: RecordingPayload,
  opts: DeliverOptions = {}
): Promise<DeliveryResult> {
  const now = opts.now ?? Date.now;
  try {
    if (kind === 'webhook') {
      if (!creds.url) return { ok: false, attempts: 0, error: 'Not configured' };
      const body = JSON.stringify(payload);
      const secret = creds.secret;
      return await postWithRetry(
        creds.url,
        () => {
          const ts = Math.floor(now() / 1000);
          const h: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'MeetingMind-Webhook/1',
            'X-MeetingMind-Timestamp': String(ts),
          };
          if (secret) h['X-MeetingMind-Signature'] = signWebhookBody(secret, ts, body);
          return h;
        },
        body,
        opts
      );
    }
    if (kind === 'slack') {
      if (!creds.url) return { ok: false, attempts: 0, error: 'Not configured' };
      return await postWithRetry(
        creds.url,
        () => ({ 'Content-Type': 'application/json' }),
        JSON.stringify(buildSlackMessage(payload)),
        opts
      );
    }
    if (!creds.secret || !creds.config?.database_id) return { ok: false, attempts: 0, error: 'Not configured' };
    const token = creds.secret;
    return await postWithRetry(
      NOTION_API,
      () => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      }),
      JSON.stringify(buildNotionPage(String(creds.config.database_id), payload)),
      opts
    );
  } catch (e) {
    return { ok: false, attempts: 0, error: e instanceof Error ? e.message : 'Delivery failed' };
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function publicView(row: IntegrationRow) {
  return {
    kind: row.kind,
    enabled: row.enabled,
    configured: true,
    display_host: row.config?.display_host ? String(row.config.display_host) : null,
    has_secret: !!row.secret_encrypted,
    database_id: row.config?.database_id ?? null,
    last_status: row.last_status,
    last_error: row.last_error,
    last_delivered_at: row.last_delivered_at,
  };
}

export async function listIntegrations(userId: string): Promise<IntegrationRow[]> {
  const { data, error } = await supabaseAdmin.from('user_integrations').select('*').eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as IntegrationRow[];
}

export async function upsertIntegration(
  userId: string,
  kind: IntegrationKind,
  input: { url?: string; secret?: string; database_id?: string; enabled?: boolean }
): Promise<IntegrationRow> {
  // Omitted url/secret mean "keep the stored value" (secrets are write-only on the client).
  const existing = (await listIntegrations(userId)).find((r) => r.kind === kind);
  const url = input.url ?? (existing?.url_encrypted ? decryptToken(existing.url_encrypted) : undefined);
  const secret = input.secret ?? (existing?.secret_encrypted ? decryptToken(existing.secret_encrypted) : undefined);
  const database_id = input.database_id ?? existing?.config?.database_id;
  validateIntegrationInput(kind, { url, secret, database_id });
  const config: Record<string, any> = {};
  if (url) config.display_host = new URL(url).hostname;
  if (database_id) config.database_id = database_id;
  const row = {
    user_id: userId,
    kind,
    enabled: input.enabled ?? existing?.enabled ?? true,
    url_encrypted: url ? encryptToken(url) : null,
    secret_encrypted: secret ? encryptToken(secret) : null,
    config,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin
    .from('user_integrations')
    .upsert(row, { onConflict: 'user_id,kind' })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as IntegrationRow;
}

export async function deleteIntegration(userId: string, kind: IntegrationKind): Promise<void> {
  const { error } = await supabaseAdmin.from('user_integrations').delete().eq('user_id', userId).eq('kind', kind);
  if (error) throw new Error(error.message);
}

function credsOf(row: IntegrationRow) {
  return {
    url: row.url_encrypted ? decryptToken(row.url_encrypted) : null,
    secret: row.secret_encrypted ? decryptToken(row.secret_encrypted) : null,
    config: row.config,
  };
}

async function record(row: IntegrationRow, recordingId: string | null, event: string, r: DeliveryResult) {
  const status = r.ok ? 'success' : 'failed';
  const err = r.error ? r.error.slice(0, 300) : null;
  await supabaseAdmin.from('integration_deliveries').insert({
    user_id: row.user_id,
    kind: row.kind,
    recording_id: recordingId,
    event,
    status,
    attempts: r.attempts,
    response_status: r.responseStatus ?? null,
    error: err,
  });
  const patch: Record<string, unknown> = { last_status: status, last_error: err };
  if (r.ok) patch.last_delivered_at = new Date().toISOString();
  await supabaseAdmin.from('user_integrations').update(patch).eq('id', row.id);
}

export async function sendTest(userId: string, kind: IntegrationKind, opts: DeliverOptions = {}): Promise<DeliveryResult> {
  const row = (await listIntegrations(userId)).find((r) => r.kind === kind);
  if (!row) return { ok: false, attempts: 0, error: 'Not configured' };
  const payload: RecordingPayload = {
    event: 'test',
    recording: { id: '00000000-0000-0000-0000-000000000000', title: 'MeetingMind test' },
    summary: 'This is a test delivery from MeetingMind.',
    key_points: [],
    action_items: [],
  };
  const r = await deliverToIntegration(kind, credsOf(row), payload, { ...opts, maxAttempts: opts.maxAttempts ?? 1 });
  await record(row, null, 'test', r);
  return r;
}

export async function listDeliveries(userId: string, limit = 20) {
  const { data, error } = await supabaseAdmin
    .from('integration_deliveries')
    .select('id,kind,recording_id,event,status,attempts,response_status,error,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Called after a recording reaches 'completed'. Never throws: integration failures
 * must not affect processing.
 */
export async function dispatchRecordingCompleted(recordingId: string, opts: DeliverOptions = {}): Promise<void> {
  try {
    const { data: rec } = await supabaseAdmin
      .from('recordings')
      .select('id,user_id,title,duration_seconds,created_at')
      .eq('id', recordingId)
      .single();
    if (!rec) return;
    const rows = (await listIntegrations(rec.user_id)).filter((r) => r.enabled);
    if (!rows.length) return;
    const { data: sum } = await supabaseAdmin
      .from('summaries')
      .select('summary,key_points,action_items')
      .eq('recording_id', recordingId)
      .maybeSingle();
    const payload: RecordingPayload = {
      event: 'recording.completed',
      recording: { id: rec.id, title: rec.title, duration_seconds: rec.duration_seconds, created_at: rec.created_at },
      summary: sum?.summary ?? '',
      key_points: sum?.key_points ?? [],
      action_items: sum?.action_items ?? [],
    };
    await Promise.all(
      rows.map(async (row) => {
        try {
          const r = await deliverToIntegration(row.kind, credsOf(row), payload, opts);
          await record(row, recordingId, payload.event, r);
        } catch (e) {
          console.error('[Integrations] delivery bookkeeping failed:', e instanceof Error ? e.message : e);
        }
      })
    );
  } catch (e) {
    console.error('[Integrations] dispatch failed:', e instanceof Error ? e.message : e);
  }
}
