import { describe, it, expect } from 'vitest';
import { ActionApprovals, MemoryApprovalStore, argsDigest, canonicalJson, APPROVAL_TTL_MS } from '../src/services/actionApprovals.js';

const U = 'user-1';
const args = { channel: 'general', text: 'Send the deck to Dan, due Friday' };
const readback = 'I will post to the general channel: send the deck to Dan, due Friday. Tap Send to confirm.';

function setup() {
  let t = 1_000_000;
  const store = new MemoryApprovalStore();
  const ap = new ActionApprovals('secret', store, () => t);
  return { ap, advance: (ms: number) => { t += ms; } };
}

describe('canonical digest', () => {
  it('does not depend on key order and changes with any value', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(argsDigest({ a: 1, b: 2 })).toBe(argsDigest({ b: 2, a: 1 }));
    expect(argsDigest({ a: 1 })).not.toBe(argsDigest({ a: 2 }));
    expect(argsDigest(args)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('two-phase approval', () => {
  it('happy path: request, read-back, token, redeem once', () => {
    const { ap, advance } = setup();
    const r = ap.request({ userId: U, sessionId: 's1', tool: 'post_to_slack', args, readback });
    expect(r.approval_id).toMatch(/^ap_[0-9a-f]{24}$/);
    expect(r.expires_in_ms).toBe(APPROVAL_TTL_MS);
    advance(r.expected_ms);
    const rb = ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: r.expected_ms });
    expect(rb.ok).toBe(true);
    if (!rb.ok) return;
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: rb.token, tool: 'post_to_slack', args })).toEqual({ ok: true });
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: rb.token, tool: 'post_to_slack', args })).toEqual({ ok: false, reason: 'already_used' });
  });

  it('no token without a long enough read-back, both played time and wall clock', () => {
    const { ap, advance } = setup();
    const r = ap.request({ userId: U, sessionId: 's1', tool: 'post_to_slack', args, readback });
    expect(ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: 100 })).toEqual({ ok: false, reason: 'readback_too_short' });
    // Claims a full playback but no time has passed.
    expect(ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: r.expected_ms })).toEqual({ ok: false, reason: 'readback_too_early' });
    advance(r.expected_ms);
    expect(ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: r.expected_ms }).ok).toBe(true);
    expect(ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: r.expected_ms })).toEqual({ ok: false, reason: 'already_issued' });
  });

  it('cannot redeem before a token was issued, or with a made-up token', () => {
    const { ap, advance } = setup();
    const r = ap.request({ userId: U, sessionId: 's1', tool: 'post_to_slack', args, readback });
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: undefined, tool: 'post_to_slack', args })).toEqual({ ok: false, reason: 'no_token' });
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: 'anything', tool: 'post_to_slack', args })).toEqual({ ok: false, reason: 'bad_token' });
    advance(r.expected_ms);
    ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: r.expected_ms });
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: 'forged-by-the-model', tool: 'post_to_slack', args })).toEqual({ ok: false, reason: 'bad_token' });
  });

  it('is bound to the exact payload and tool: changing either fails and does not burn the approval', () => {
    const { ap, advance } = setup();
    const r = ap.request({ userId: U, sessionId: 's1', tool: 'post_to_slack', args, readback });
    advance(r.expected_ms);
    const rb = ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: r.expected_ms });
    if (!rb.ok) throw new Error('setup');
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: rb.token, tool: 'post_to_slack', args: { ...args, text: 'Wire the money' } })).toEqual({ ok: false, reason: 'token_mismatch' });
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: rb.token, tool: 'post_to_notion', args })).toEqual({ ok: false, reason: 'token_mismatch' });
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: rb.token, tool: 'post_to_slack', args })).toEqual({ ok: true });
  });

  it('is bound to the user and expires', () => {
    const { ap, advance } = setup();
    const r = ap.request({ userId: U, sessionId: 's1', tool: 'post_to_slack', args, readback });
    advance(r.expected_ms);
    expect(ap.readbackComplete({ userId: 'user-2', approvalId: r.approval_id, playedMs: r.expected_ms })).toEqual({ ok: false, reason: 'wrong_user' });
    const rb = ap.readbackComplete({ userId: U, approvalId: r.approval_id, playedMs: r.expected_ms });
    if (!rb.ok) throw new Error('setup');
    expect(ap.redeem({ userId: 'user-2', approvalId: r.approval_id, token: rb.token, tool: 'post_to_slack', args })).toEqual({ ok: false, reason: 'wrong_user' });
    advance(APPROVAL_TTL_MS + 1);
    expect(ap.redeem({ userId: U, approvalId: r.approval_id, token: rb.token, tool: 'post_to_slack', args })).toEqual({ ok: false, reason: 'expired' });
    expect(ap.redeem({ userId: U, approvalId: 'ap_unknown', token: rb.token, tool: 'x', args })).toEqual({ ok: false, reason: 'unknown_approval' });
  });

  it('a token from one session/approval is useless for another', () => {
    const { ap, advance } = setup();
    const r1 = ap.request({ userId: U, sessionId: 's1', tool: 'post_to_slack', args, readback });
    const r2 = ap.request({ userId: U, sessionId: 's1', tool: 'post_to_slack', args, readback });
    advance(r1.expected_ms);
    const t1 = ap.readbackComplete({ userId: U, approvalId: r1.approval_id, playedMs: r1.expected_ms });
    ap.readbackComplete({ userId: U, approvalId: r2.approval_id, playedMs: r2.expected_ms });
    if (!t1.ok) throw new Error('setup');
    expect(ap.redeem({ userId: U, approvalId: r2.approval_id, token: t1.token, tool: 'post_to_slack', args })).toEqual({ ok: false, reason: 'bad_token' });
  });

  it('refuses to run without a secret', () => {
    expect(() => new ActionApprovals('')).toThrow();
  });
});
