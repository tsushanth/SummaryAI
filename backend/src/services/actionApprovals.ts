/**
 * Two-phase approval for actions that leave the app (post to Slack/Notion/a webhook, anything another person can see).
 * DESIGN STUB: nothing calls this yet, no route is mounted, and no outward action exists behind it.
 *
 * Shape (kept deliberately thin so the transport around it can change):
 *   1. request()           -> { approval_id, args_digest, readback, expected_ms, expires_in_ms }   nothing has run
 *   2. the client reads `readback` aloud / shows the exact payload, then reports back:
 *      readbackComplete()  -> { ok, token } | { ok:false, reason }     refused if the read-back was too short or too early
 *   3. the user taps/says yes, the client sends the token back:
 *      redeem()            -> { ok:true } once, then never again
 *
 * The token is an HMAC over (session, approval id, tool, SHA-256 of the exact args). It is single use and short lived, and
 * it can only be produced by this module after a read-back was recorded: a model cannot mint one by writing text. The
 * server cannot hear the phone; this proves a client that follows the protocol cannot execute without a read-back, not that
 * a human listened. The action's own endpoint must still require `redeem()` to succeed and must re-derive the digest from
 * the payload it is about to send.
 *
 * Storage is behind ApprovalStore. The in-memory default is per process: with more than one backend machine an approval
 * must be redeemed on the machine that issued it, so a shared store (a database row with a unique constraint) is required
 * before this goes live.
 */

import crypto from 'node:crypto';

export interface ApprovalRecord {
  approvalId: string;
  sessionId: string;
  userId: string;
  tool: string;
  argsDigest: string;
  expectedMs: number;
  issuedAt: number;
  expiresAt: number;
  tokenIssued: boolean;
  used: boolean;
}

/** Minimal persistence the module needs. All methods must be atomic where noted. */
export interface ApprovalStore {
  put(rec: ApprovalRecord): void;
  get(approvalId: string): ApprovalRecord | undefined;
  /** Atomic: marks the token as issued and returns true only the first time. */
  markTokenIssued(approvalId: string): boolean;
  /** Atomic: marks the approval as used and returns true only the first time. */
  markUsed(approvalId: string): boolean;
}

export class MemoryApprovalStore implements ApprovalStore {
  private recs = new Map<string, ApprovalRecord>();
  put(rec: ApprovalRecord): void { this.recs.set(rec.approvalId, rec); }
  get(id: string): ApprovalRecord | undefined { return this.recs.get(id); }
  markTokenIssued(id: string): boolean {
    const r = this.recs.get(id);
    if (!r || r.tokenIssued) return false;
    r.tokenIssued = true;
    return true;
  }
  markUsed(id: string): boolean {
    const r = this.recs.get(id);
    if (!r || r.used) return false;
    r.used = true;
    return true;
  }
}

export type ApprovalRejection =
  | 'unknown_approval'
  | 'wrong_user'
  | 'expired'
  | 'readback_too_short'
  | 'readback_too_early'
  | 'already_issued'
  | 'no_token'
  | 'bad_token'
  | 'token_mismatch'
  | 'already_used';

export interface ApprovalRequest {
  approval_id: string;
  args_digest: string;
  readback: string;
  expected_ms: number;
  expires_in_ms: number;
}

export const APPROVAL_TTL_MS = 120_000;
/** Speaking rate used to estimate how long the read-back should take. */
const MS_PER_CHAR = 65;
/** The client must report at least this share of the expected duration, both as played time and as wall-clock time. */
const MIN_PLAYED_SHARE = 0.6;

/** Canonical JSON (sorted keys) so the same arguments always hash the same. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export function argsDigest(args: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(args)).digest('hex');
}

export class ActionApprovals {
  constructor(
    private readonly secret: string,
    private readonly store: ApprovalStore = new MemoryApprovalStore(),
    private readonly now: () => number = Date.now
  ) {
    if (!secret) throw new Error('ActionApprovals needs a secret');
  }

  request(opts: { userId: string; sessionId: string; tool: string; args: unknown; readback: string }): ApprovalRequest {
    const approvalId = `ap_${crypto.randomBytes(12).toString('hex')}`;
    const expectedMs = Math.max(1500, opts.readback.length * MS_PER_CHAR);
    const t = this.now();
    this.store.put({
      approvalId,
      sessionId: opts.sessionId,
      userId: opts.userId,
      tool: opts.tool,
      argsDigest: argsDigest(opts.args),
      expectedMs,
      issuedAt: t,
      expiresAt: t + APPROVAL_TTL_MS,
      tokenIssued: false,
      used: false,
    });
    return { approval_id: approvalId, args_digest: argsDigest(opts.args), readback: opts.readback, expected_ms: expectedMs, expires_in_ms: APPROVAL_TTL_MS };
  }

  private tokenFor(r: ApprovalRecord): string {
    return crypto
      .createHmac('sha256', this.secret)
      .update(`${r.sessionId}|${r.approvalId}|${r.tool}|${r.argsDigest}`)
      .digest('base64url');
  }

  readbackComplete(opts: { userId: string; approvalId: string; playedMs: number }): { ok: true; token: string; expires_in_ms: number } | { ok: false; reason: ApprovalRejection } {
    const r = this.store.get(opts.approvalId);
    if (!r) return { ok: false, reason: 'unknown_approval' };
    if (r.userId !== opts.userId) return { ok: false, reason: 'wrong_user' };
    const t = this.now();
    if (t > r.expiresAt) return { ok: false, reason: 'expired' };
    const need = r.expectedMs * MIN_PLAYED_SHARE;
    if (!Number.isFinite(opts.playedMs) || opts.playedMs < need) return { ok: false, reason: 'readback_too_short' };
    if (t - r.issuedAt < need) return { ok: false, reason: 'readback_too_early' };
    if (!this.store.markTokenIssued(r.approvalId)) return { ok: false, reason: 'already_issued' };
    return { ok: true, token: this.tokenFor(r), expires_in_ms: Math.max(0, r.expiresAt - t) };
  }

  /** Single use. `args` is what the caller is about to execute: it is re-hashed here, not trusted from the client. */
  redeem(opts: { userId: string; approvalId: string; token: string | undefined; tool: string; args: unknown }): { ok: true } | { ok: false; reason: ApprovalRejection } {
    const r = this.store.get(opts.approvalId);
    if (!r) return { ok: false, reason: 'unknown_approval' };
    if (r.userId !== opts.userId) return { ok: false, reason: 'wrong_user' };
    if (this.now() > r.expiresAt) return { ok: false, reason: 'expired' };
    if (!opts.token) return { ok: false, reason: 'no_token' };
    if (!r.tokenIssued) return { ok: false, reason: 'bad_token' };
    const a = Buffer.from(opts.token);
    const b = Buffer.from(this.tokenFor(r));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_token' };
    if (opts.tool !== r.tool || argsDigest(opts.args) !== r.argsDigest) return { ok: false, reason: 'token_mismatch' };
    if (!this.store.markUsed(r.approvalId)) return { ok: false, reason: 'already_used' };
    return { ok: true };
  }
}
