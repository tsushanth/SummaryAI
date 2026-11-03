import { describe, expect, it } from 'vitest';
import { ensureFixture } from './harness/fixture.js';
import { runReplay, type ReplayReport } from './harness/replay.js';

const fixture = ensureFixture();
const SPEED = 10;

function commonChecks(r: ReplayReport): void {
  expect(r.rows.length).toBeGreaterThan(8);
  expect(r.orderOk, 'segments arrive in time order').toBe(true);
  expect(r.seqOk, 'seq strictly increasing at the backend').toBe(true);
  expect(r.duplicateKeys).toBe(0);
  expect(r.backendBadSignatures).toBe(0);
  expect(r.unhandled, 'no unhandled rejections').toEqual([]);
  expect(r.wordLossPct, `words lost ${r.wordsMissing}/${r.expectedWords.length}`).toBeLessThan(2);
  expect(r.wordsExtra, 'no duplicated words').toBeLessThanOrEqual(Math.ceil(r.expectedWords.length * 0.02));
  expect(r.speakerWordAccuracy, JSON.stringify(r.speakerWrong)).toBeGreaterThanOrEqual(0.98);
  // bounded memory: buffer never above the hard cap, heap growth small
  expect(r.maxBufferedBytes).toBeLessThanOrEqual(60_000 * 32 + 6400);
  expect(r.heapGrowthMb).toBeLessThan(64);
  for (const row of r.rows) {
    expect(row.is_partial).toBe(false);
    expect(['Alice Moreno', 'Bob Okafor']).toContain(row.speaker_name);
  }
}

describe('replay harness (60 s two-voice meeting, simulated Recall -> service -> fake Soniox -> fake backend)', () => {
  it('happy path: ordered, correctly attributed, nothing lost, nothing unhandled', async () => {
    const r = await runReplay({ fixture, engine: 'fake', speed: SPEED });
    console.log(`[replay happy] segments=${r.rows.length} wordLoss=${r.wordLossPct.toFixed(2)}% speakerAcc=${(r.speakerWordAccuracy * 100).toFixed(1)}% coverage=${r.audioCoveragePct?.toFixed(1)}% delayP50=${r.segmentDelayP50s.toFixed(1)}s heap+${r.heapGrowthMb.toFixed(1)}MB maxBuf=${r.maxBufferedBytes}`);
    commonChecks(r);
    expect(r.reconnects).toBe(0);
    expect(r.streams).toBe(1);
    expect(r.audioCoveragePct).toBeGreaterThanOrEqual(99.9);
    expect(r.fakeStreams![0]!.sawBearerHeader).toBe(true); // header auth is the default; the in-frame api_key is deprecated
    expect(r.fakeStreams![0]!.sawApiKeyInFrame).toBe(false);
  }, 60_000);

  it('injected Soniox disconnect at 25 s (with renumbered speaker labels): reconnect replay loses < 2% of audio and words', async () => {
    const r = await runReplay({
      fixture, engine: 'fake', speed: SPEED,
      fake: { dropStream: { index: 0, atAudioMs: 25_000 }, swapLabelsAfterFirst: true },
    });
    console.log(`[replay drop] segments=${r.rows.length} reconnects=${r.reconnects} streams=${r.streams} wordLoss=${r.wordLossPct.toFixed(2)}% extra=${r.wordsExtra} speakerAcc=${(r.speakerWordAccuracy * 100).toFixed(1)}% coverage=${r.audioCoveragePct?.toFixed(1)}% gapSeconds=${r.metrics.gapSeconds} delayP50=${r.segmentDelayP50s.toFixed(1)}s`);
    commonChecks(r);
    expect(r.reconnects).toBe(1);
    expect(r.streams).toBe(2);
    expect(r.fakeStreams![0]!.closedBy).toBe('drop');
    expect(r.audioCoveragePct, 'audio the fake Soniox received in any stream').toBeGreaterThanOrEqual(98);
    expect(Number(r.metrics.gapSeconds)).toBeLessThan(0.02 * 60);
  }, 60_000);

  it('survives Soniox 429s on connect, a backend outage and a client-side socket cut together', async () => {
    const r = await runReplay({
      fixture, engine: 'fake', speed: SPEED,
      fake: { rejectNext: { count: 2, error_code: 429, error_type: 'rate_limit' } },
      session: { rateLimitBackoffMs: 300, backoffMs: [100, 200] },
      backendFailFirst: 3,
      cutClientAtAudioMs: 30_000,
    });
    console.log(`[replay chaos] segments=${r.rows.length} reconnects=${r.reconnects} streams=${r.streams} wordLoss=${r.wordLossPct.toFixed(2)}% backendReq=${r.backendRequests}`);
    commonChecks(r);
    expect(r.streams).toBeGreaterThanOrEqual(4); // 2 rejected + first stream + replacement
    expect(r.backendRequests).toBeGreaterThan(r.rows.length / 20 + 3);
  }, 90_000);
});
