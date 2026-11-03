import { describe, expect, it } from 'vitest';
import { loadSonioxKey } from '../scripts/loadKey.js';
import { ensureFixture } from './harness/fixture.js';
import { runReplay } from './harness/replay.js';

/**
 * OPT-IN: runs the replay harness against the REAL Soniox realtime API (about 2.2 minutes of audio, roughly $0.005).
 *   REAL_SONIOX=1 npm test -- test/replay.real.test.ts
 * The key comes from SONIOX_API_KEY or a local file named by SONIOX_ENV_FILE, into process.env only (scripts/loadKey.ts). Audio is our own `say` fixture.
 * Skipped by default so `npm test` never touches the network.
 */
const enabled = process.env.REAL_SONIOX === '1' && loadSonioxKey();

describe.skipIf(!enabled)('REAL Soniox replay (opt-in)', () => {
  it('a mid-meeting socket cut loses no more than an uncut run (replay of the last seconds works)', async () => {
    const fixture = ensureFixture();
    const common = { fixture, engine: 'real' as const, speed: 1, sonioxApiKey: process.env.SONIOX_API_KEY };
    const [base, cut] = await Promise.all([runReplay(common), runReplay({ ...common, cutClientAtAudioMs: 25_000 })]);
    console.log(`[real] base loss ${base.wordLossPct.toFixed(2)}% extra ${base.wordsExtra} | cut loss ${cut.wordLossPct.toFixed(2)}% extra ${cut.wordsExtra} reconnects ${cut.reconnects} delayP50 ${cut.segmentDelayP50s.toFixed(1)}s`);
    expect(cut.reconnects).toBe(1);
    expect(cut.wordLossPct).toBeLessThanOrEqual(base.wordLossPct + 2);
    expect(cut.wordsExtra).toBeLessThanOrEqual(base.wordsExtra + Math.ceil(base.expectedWords.length * 0.02));
    expect(cut.speakerWordAccuracy).toBeGreaterThanOrEqual(0.9);
    expect(cut.orderOk && base.orderOk).toBe(true);
    expect(cut.unhandled).toEqual([]);
  }, 180_000);
});
