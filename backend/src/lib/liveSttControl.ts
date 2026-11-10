/**
 * Backend -> mm-live-stt control channel (live language change). See backend/LIVE_STT.md.
 *
 *   POST <LIVE_STT_WS_URL with wss->https>/control/language
 *   x-mm-timestamp: <unix seconds>   x-mm-signature: v1=hex(HMAC-SHA256(secret, "control.<ts>.<raw body>"))
 *   body {"v":1,"ref":"<bot_runs.live_stt_ref>","language":"es"|"auto"}
 *
 * Service answers 200 {applied:true} (session found, stream reconfigured or already on that language), 202 {applied:false,queued:true}
 * (no session for that ref yet: the change is applied when its audio connects), 404 (route disabled), 401, 400.
 * Nothing here logs the secret, the signature or the ref.
 */
import { config } from '../config/index.js';
import { parseSecretList, signLiveControl } from './liveStt.js';

export interface LiveControlResult {
  ok: boolean;
  /** ok: 'applied' (stream reconfigured / already on it) or 'queued' (no audio session yet; applied when it connects). */
  state?: 'applied' | 'queued';
  /** !ok */
  reason?: 'not_configured' | 'unauthorized' | 'rejected' | 'unreachable' | 'server_error';
}

export function liveControlBaseUrl(wsUrl: string | undefined): string | null {
  const v = (wsUrl ?? '').trim().replace(/\/+$/, '');
  const m = /^(wss?):\/\/([^/?#\s]+)$/i.exec(v);
  if (!m) return null;
  return `${m[1]!.toLowerCase() === 'wss' ? 'https' : 'http'}://${m[2]}`;
}

export async function notifyLiveLanguage(
  ref: string,
  language: string,
  deps: { fetchImpl?: typeof fetch; nowSec?: () => number; timeoutMs?: number } = {}
): Promise<LiveControlResult> {
  const base = liveControlBaseUrl(config.LIVE_STT_WS_URL);
  const secret = (config.LIVE_STT_CONTROL_SECRET ?? '').trim() || parseSecretList(config.LIVE_STT_SHARED_SECRET)[0] || '';
  if (!base || !secret) return { ok: false, reason: 'not_configured' };

  const body = JSON.stringify({ v: 1, ref, language });
  const ts = String((deps.nowSec ?? (() => Math.floor(Date.now() / 1000)))());
  try {
    const res = await (deps.fetchImpl ?? fetch)(`${base}/control/language`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-mm-timestamp': ts, 'x-mm-signature': signLiveControl(secret, ts, body) },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
    if (res.status === 200) return { ok: true, state: 'applied' };
    if (res.status === 202) return { ok: true, state: 'queued' };
    if (res.status === 401) return { ok: false, reason: 'unauthorized' };
    if (res.status >= 500 || res.status === 429 || res.status === 408) return { ok: false, reason: 'server_error' };
    return { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}
