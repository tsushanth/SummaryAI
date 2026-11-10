import { describe, expect, it } from 'vitest';
import { signControl } from '../src/control.js';
import { ensureFixture } from './harness/fixture.js';
import { runReplay } from './harness/replay.js';

const fixture = ensureFixture();
const SPEED = 10;

const postLanguage = (language: string) => async (ctx: { port: number; ref: string; controlSecret: string }) => {
  const raw = JSON.stringify({ v: 1, ref: ctx.ref, language });
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await fetch(`http://127.0.0.1:${ctx.port}/control/language`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mm-timestamp': ts, 'x-mm-signature': signControl(ctx.controlSecret, ts, raw) },
    body: raw,
  });
  expect(r.status).toBe(200);
};

describe('replay with the fake Soniox server: language handling', () => {
  it('no language: the Soniox config frame carries no language_hints, identification stays on', async () => {
    const r = await runReplay({ fixture, engine: 'fake', speed: SPEED });
    const cfg = r.fakeStreams![0]!.config!;
    expect(cfg).not.toHaveProperty('language_hints');
    expect(cfg.enable_language_identification).toBe(true);
  }, 60_000);

  it('language from the ingest URL becomes language_hints on the first stream', async () => {
    const r = await runReplay({ fixture, engine: 'fake', speed: SPEED, ingestQuery: '&lang=fr' });
    expect(r.fakeStreams![0]!.config!.language_hints).toEqual(['fr']);
    expect(r.fakeStreams![0]!.config!.enable_language_identification).toBe(true);
  }, 60_000);

  it('changing the language at 25 s reopens the stream with the new hints and loses no words or audio', async () => {
    const r = await runReplay({
      fixture, engine: 'fake', speed: SPEED, ingestQuery: '&lang=en',
      actions: [{ atAudioMs: 25_000, run: postLanguage('es') }],
    });
    console.log(`[replay language change] segments=${r.rows.length} streams=${r.streams} wordLoss=${r.wordLossPct.toFixed(2)}% extra=${r.wordsExtra} coverage=${r.audioCoveragePct?.toFixed(1)}% gapSeconds=${r.metrics.gapSeconds}`);
    expect(r.streams).toBe(2);
    expect(r.fakeStreams![0]!.config!.language_hints).toEqual(['en']);
    expect(r.fakeStreams![1]!.config!.language_hints).toEqual(['es']);
    expect(r.fakeStreams![0]!.closedBy).toBe('client');
    expect(r.metrics.languageChanges).toBe(1);
    expect(r.metrics.reconnects).toBe(0);
    expect(r.unhandled).toEqual([]);
    expect(r.orderOk).toBe(true);
    expect(r.seqOk).toBe(true);
    expect(r.duplicateKeys).toBe(0);
    expect(r.backendBadSignatures).toBe(0);
    expect(r.audioCoveragePct).toBeGreaterThanOrEqual(99);
    expect(r.wordLossPct, `words lost ${r.wordsMissing}/${r.expectedWords.length}`).toBeLessThan(2);
    expect(r.wordsExtra, 'no duplicated words').toBeLessThanOrEqual(Math.ceil(r.expectedWords.length * 0.02));
    expect(Number(r.metrics.gapSeconds)).toBe(0);
  }, 60_000);

  it('switching to auto drops the hints', async () => {
    const r = await runReplay({
      fixture, engine: 'fake', speed: SPEED, ingestQuery: '&lang=de',
      actions: [{ atAudioMs: 20_000, run: postLanguage('auto') }],
    });
    expect(r.fakeStreams![0]!.config!.language_hints).toEqual(['de']);
    expect(r.fakeStreams![1]!.config).not.toHaveProperty('language_hints');
    expect(r.wordLossPct).toBeLessThan(2);
  }, 60_000);
});
