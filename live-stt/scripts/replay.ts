/**
 * Replay a 60 s two-voice meeting through the service.
 *   npx tsx scripts/replay.ts                     fake Soniox, 10x speed, drop at 25 s
 *   npx tsx scripts/replay.ts --real --speed 1    REAL Soniox (opt-in; key read from a local env file into process.env only)
 * Exit code 1 if a check fails.
 */
import { ensureFixture } from '../test/harness/fixture.js';
import { runReplay, type ReplayReport } from '../test/harness/replay.js';
import { loadSonioxKey } from './loadKey.js';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string, d: number) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const real = flag('real');
if (real && !loadSonioxKey()) { console.error('no SONIOX_API_KEY available'); process.exit(2); }
const speed = val('speed', real ? 1 : 10);
const cut = flag('no-cut') ? undefined : val('cut-at-ms', 25_000);

const r = await runReplay({
  fixture: ensureFixture(), engine: real ? 'real' : 'fake', speed,
  cutClientAtAudioMs: real ? cut : undefined,
  fake: real || cut === undefined ? undefined : { dropStream: { index: 0, atAudioMs: cut }, swapLabelsAfterFirst: true },
  sonioxApiKey: process.env.SONIOX_API_KEY,
});

export function summarize(r: ReplayReport): string {
  return [
    `engine=${r.engine} speed=${r.speed}x segments=${r.rows.length} streams=${r.streams} reconnects=${r.reconnects}`,
    `word loss ${r.wordLossPct.toFixed(2)}% (${r.wordsMissing}/${r.expectedWords.length}), extra words ${r.wordsExtra}`,
    `speaker accuracy ${(r.speakerWordAccuracy * 100).toFixed(1)}%  ordered=${r.orderOk} seqOk=${r.seqOk} duplicateKeys=${r.duplicateKeys}`,
    `audio coverage ${r.audioCoveragePct === null ? 'n/a (real)' : r.audioCoveragePct.toFixed(1) + '%'}  gapSeconds=${r.metrics.gapSeconds}`,
    `segment delay after last word (audio s): p50 ${r.segmentDelayP50s.toFixed(1)} p90 ${r.segmentDelayP90s.toFixed(1)}`,
    `max buffered ${r.maxBufferedBytes} B, heap growth ${r.heapGrowthMb.toFixed(1)} MB, unhandled ${r.unhandled.length}, bad signatures ${r.backendBadSignatures}`,
  ].join('\n');
}
console.log(summarize(r));
if (r.speakerWrong.length) console.log('speaker mismatches:', JSON.stringify(r.speakerWrong));
const fails: string[] = [];
if (!real && r.wordLossPct >= 2) fails.push('word loss >= 2%');
if (!r.orderOk) fails.push('segments out of order');
if (r.unhandled.length) fails.push('unhandled rejections');
if (r.speakerWordAccuracy < (real ? 0.9 : 0.98)) fails.push('speaker accuracy low');
if (fails.length) { console.error('FAILED:', fails.join('; ')); process.exit(1); }
