/**
 * Which live transcription provider a USER gets for a new bot. One resolver, driven only by environment, so a rollout can go
 * allowlist -> owner -> small percentage -> everyone, and be undone, without a code change. See backend/LIVE_STT.md.
 *
 *   LIVE_STT_PROVIDER            recall (default; also any unknown value) | soniox | auto
 *   LIVE_STT_SONIOX_USER_IDS     comma separated user UUIDs, only read when LIVE_STT_PROVIDER=auto
 *   LIVE_STT_SONIOX_PERCENT      0-100 (fractions allowed), only read when LIVE_STT_PROVIDER=auto
 *
 *   recall  nobody gets Soniox. This is the kill switch: it also overrides the allowlist and the percentage.
 *   soniox  every user gets Soniox (a deliberate global switch; the last rollout step).
 *   auto    a user gets Soniox if they are on the allowlist, or their stable hash bucket is below the percentage. Everyone else
 *           stays on Recall. A call without a user id gets Recall (fails closed).
 *
 * The percentage is monotonic: a user selected at 5% is still selected at 25%, so widening the rollout never moves someone back
 * to Recall. Buckets are computed from the user id only (no per-meeting randomness): a user does not flip between providers from
 * one meeting to the next.
 */
import { createHash } from 'node:crypto';

export interface LiveSttSelectEnv {
  LIVE_STT_PROVIDER?: string | undefined;
  LIVE_STT_SONIOX_USER_IDS?: string | undefined;
  LIVE_STT_SONIOX_PERCENT?: string | number | undefined;
}

export type LiveSttChoiceReason = 'default' | 'all' | 'allowlist' | 'percent' | 'not_selected' | 'no_user';

export interface LiveSttChoice {
  provider: 'recall' | 'soniox';
  reason: LiveSttChoiceReason;
}

const BUCKET_SALT = 'mm-live-stt-soniox-v1';

/** Stable bucket in [0, 100) with 0.01 resolution, from the lowercased user id. */
export function percentBucket(userId: string): number {
  const h = createHash('sha256').update(`${BUCKET_SALT}:${userId.trim().toLowerCase()}`).digest();
  return (h.readUInt32BE(0) % 10_000) / 100;
}

/** Clamp to [0, 100]; anything that is not a finite number (unset, '', 'abc') is 0. */
export function parsePercent(v: string | number | undefined): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function parseIds(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function liveSttProviderFor(
  user: string | { id?: string | null } | null | undefined,
  env: LiveSttSelectEnv = process.env as LiveSttSelectEnv
): LiveSttChoice {
  const mode = (env.LIVE_STT_PROVIDER ?? 'recall').trim().toLowerCase();
  if (mode === 'recall' || mode === '') return { provider: 'recall', reason: 'default' };
  if (mode === 'soniox') return { provider: 'soniox', reason: 'all' };
  if (mode !== 'auto') return { provider: 'recall', reason: 'default' }; // a typo never changes behaviour

  const id = (typeof user === 'string' ? user : user?.id ?? '').trim().toLowerCase();
  if (!id) return { provider: 'recall', reason: 'no_user' };
  if (parseIds(env.LIVE_STT_SONIOX_USER_IDS).includes(id)) return { provider: 'soniox', reason: 'allowlist' };
  const pct = parsePercent(env.LIVE_STT_SONIOX_PERCENT);
  if (pct > 0 && percentBucket(id) < pct) return { provider: 'soniox', reason: 'percent' };
  return { provider: 'recall', reason: 'not_selected' };
}
