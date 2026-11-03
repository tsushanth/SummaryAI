import { describe, expect, it } from 'vitest';
import { mintIngestToken, parseIngestUrl, verifyIngestToken } from '../src/auth.js';

const REF = '6f1c2a9e-1111-4a2b-9c3d-0123456789ab';

describe('ingest token', () => {
  it('verifies a token minted for the same ref', () => {
    const t = mintIngestToken('s3cret', REF);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyIngestToken('s3cret', REF, t)).toBe(true);
  });
  it('rejects a token for another ref, another secret, empty, wrong length, or non-hex', () => {
    const t = mintIngestToken('s3cret', REF);
    expect(verifyIngestToken('s3cret', REF.replace('6f1c', '7f1c'), t)).toBe(false);
    expect(verifyIngestToken('other', REF, t)).toBe(false);
    expect(verifyIngestToken('s3cret', REF, '')).toBe(false);
    expect(verifyIngestToken('s3cret', REF, undefined)).toBe(false);
    expect(verifyIngestToken('s3cret', REF, t.slice(0, 63))).toBe(false);
    expect(verifyIngestToken('s3cret', REF, 'z'.repeat(64))).toBe(false);
  });
  it('accepts any secret in a rotation list', () => {
    const old = mintIngestToken('old', REF);
    expect(verifyIngestToken(['new', 'old'], REF, old)).toBe(true);
    expect(verifyIngestToken(['new'], REF, old)).toBe(false);
    expect(verifyIngestToken([], REF, old)).toBe(false);
  });
});

describe('parseIngestUrl', () => {
  it('parses /ingest/<ref>/?token=', () => {
    expect(parseIngestUrl(`/ingest/${REF}/?token=abc`)).toEqual({ ref: REF, token: 'abc' });
  });
  it('requires the trailing slash Recall needs and a sane ref', () => {
    expect(parseIngestUrl(`/ingest/${REF}?token=abc`)).toBeNull();
    expect(parseIngestUrl('/ingest/../etc/?token=abc')).toBeNull();
    expect(parseIngestUrl('/ingest/short/?token=abc')).toBeNull();
    expect(parseIngestUrl(`/other/${REF}/?token=abc`)).toBeNull();
  });
  it('returns an empty token when absent so the caller counts it as a failure', () => {
    expect(parseIngestUrl(`/ingest/${REF}/`)).toEqual({ ref: REF, token: '' });
  });
});
