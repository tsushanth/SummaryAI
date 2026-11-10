/**
 * Opt-in probe against the REAL Soniox realtime API (a short run).
 * Streams only audio we generate ourselves with `say` (test/.fixtures), never a user recording.
 * Prints measurements and the SHAPE of the messages; never prints the key, the config frame, or request headers.
 *
 *   npx tsx scripts/probe-real.ts english|multilang|cut|header|concurrency
 */
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { ensureFixture } from '../test/harness/fixture.js';
import { buildSonioxConfig } from '../src/stt/soniox.js';
import { loadSonioxKey } from './loadKey.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!loadSonioxKey()) { console.error('no SONIOX_API_KEY available'); process.exit(2); }
const KEY = process.env.SONIOX_API_KEY!;
const URL_ = 'wss://stt-rt.soniox.com/transcribe-websocket';
const CHUNK = 6400;

interface Msg { t: number; raw: any }

function sayClip(voice: string, text: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'probe-'));
  const out = join(dir, 'a.wav');
  execFileSync('say', ['-v', voice, '--file-format=WAVE', '--data-format=LEI16@16000', '-o', out, text]);
  const b = readFileSync(out);
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (id === 'data') return b.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error('wav');
}

/** Streams pcm at `speed`x real time. Returns all received messages with arrival time relative to stream start. */
function run(pcm: Buffer, o: { mode?: 'header' | 'config'; speed?: number; hints?: string[]; cutAtMs?: number; endpoint?: boolean; epDelay?: number; finalizeEveryMs?: number } = {}): Promise<{ msgs: Msg[]; openMs: number; closeCode: number; startedAt: number; cfgAccepted: boolean }> {
  return new Promise((resolve) => {
    const mode = o.mode ?? 'config';
    const t0 = Date.now();
    const ws = new WebSocket(URL_, { headers: mode === 'header' ? { Authorization: `Bearer ${KEY}` } : {} });
    const msgs: Msg[] = [];
    let startedAt = 0;
    let openMs = 0;
    ws.on('open', async () => {
      openMs = Date.now() - t0;
      ws.send(JSON.stringify(buildSonioxConfig({ model: 'stt-rt-v6', terms: [], languageHints: o.hints ?? [], diarization: true, endpointDetection: o.endpoint, endpointMaxDelayMs: o.epDelay, apiKey: mode === 'header' ? undefined : KEY })));
      startedAt = Date.now();
      const speed = o.speed ?? 1;
      for (let off = 0, i = 0; off < pcm.length; off += CHUNK, i++) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (o.cutAtMs !== undefined && i * 200 >= o.cutAtMs) { ws.terminate(); return; }
        ws.send(pcm.subarray(off, Math.min(off + CHUNK, pcm.length)));
        if (o.finalizeEveryMs && i > 0 && (i * 200) % o.finalizeEveryMs === 0) ws.send(JSON.stringify({ type: 'finalize' }));
        const due = startedAt + ((i + 1) * 200) / speed;
        const wait = due - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      if (ws.readyState === WebSocket.OPEN) ws.send('');
    });
    ws.on('message', (d) => { try { msgs.push({ t: Date.now() - startedAt, raw: JSON.parse(d.toString()) }); } catch { /* */ } });
    ws.on('unexpected-response', (_q, res) => { console.log('handshake status', res.statusCode); res.resume(); });
    ws.on('error', (e) => console.log('ws error', (e as Error).message.replace(KEY, '***')));
    ws.on('close', (code) => resolve({ msgs, openMs, closeCode: code, startedAt, cfgAccepted: msgs.some((m) => Array.isArray(m.raw.tokens)) }));
  });
}

const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]! : NaN);

function analyze(label: string, r: Awaited<ReturnType<typeof run>>, audioMs: number): void {
  console.log(`--- ${label}: open ${r.openMs} ms, close ${r.closeCode}, messages ${r.msgs.length}`);
  const errs = r.msgs.filter((m) => m.raw.error_code !== undefined || m.raw.error_message !== undefined);
  for (const e of errs) console.log('error frame keys:', Object.keys(e.raw).join(','), 'code', e.raw.error_code, 'type', e.raw.error_type);
  const firstTok = r.msgs.find((m) => m.raw.tokens?.length);
  if (firstTok) console.log('first token message (shape):', JSON.stringify({ ...firstTok.raw, tokens: firstTok.raw.tokens.slice(0, 3) }));
  const keys = new Set<string>();
  const tokKeys = new Set<string>();
  for (const m of r.msgs) { Object.keys(m.raw).forEach((k) => keys.add(k)); for (const t of m.raw.tokens ?? []) Object.keys(t).forEach((k) => tokKeys.add(k)); }
  console.log('message keys:', [...keys].join(','), '| token keys:', [...tokKeys].join(','));
  const seenPartial = new Set<string>(); const partialLat: number[] = []; const finalLat: number[] = [];
  const seenFinal = new Set<string>();
  const labels = new Map<string, number>(); const langs = new Map<string, number>();
  let finishedMsg: Msg | undefined; const specials = new Set<string>();
  for (const m of r.msgs) {
    if (m.raw.finished) finishedMsg = m;
    for (const t of m.raw.tokens ?? []) {
      if (/^<.*>$/.test(t.text)) specials.add(t.text);
      const id = `${t.start_ms}:${t.text}`;
      if (t.is_final) {
        if (!seenFinal.has(id)) { seenFinal.add(id); finalLat.push(m.t - t.end_ms); labels.set(String(t.speaker), (labels.get(String(t.speaker)) ?? 0) + 1); langs.set(String(t.language), (langs.get(String(t.language)) ?? 0) + 1); }
      } else if (!seenPartial.has(id)) { seenPartial.add(id); partialLat.push(m.t - t.end_ms); }
    }
  }
  console.log(`first-partial latency after word end (ms): p50 ${pct(partialLat, 0.5)} p90 ${pct(partialLat, 0.9)}  | final latency after word end: p50 ${pct(finalLat, 0.5)} p90 ${pct(finalLat, 0.9)} max ${Math.max(...finalLat)}`);
  if (label.includes('2-speaker')) {
    const conf = new Map<string, number>();
    for (const m of r.msgs) for (const t of m.raw.tokens ?? []) {
      if (!t.is_final || /^<.*>$/.test(t.text)) continue;
      const u = fx.utterances.find((x) => t.start_ms >= x.startMs - 150 && t.start_ms <= x.endMs + 150);
      if (u) conf.set(`${u.who}->${t.speaker}`, (conf.get(`${u.who}->${t.speaker}`) ?? 0) + 1);
    }
    console.log('diarization confusion (truth->label):', JSON.stringify([...conf]));
  }
  const lag = r.msgs.filter((m) => typeof m.raw.final_audio_proc_ms === 'number').map((m) => m.raw.total_audio_proc_ms - m.raw.final_audio_proc_ms);
  console.log('total-final watermark gap ms: p50', pct(lag, 0.5), 'p90', pct(lag, 0.9), 'max', Math.max(...lag));
  console.log('final tokens by speaker label:', JSON.stringify([...labels]), 'language:', JSON.stringify([...langs]), 'special tokens:', [...specials].join(' ') || 'none');
  if (finishedMsg) console.log('finished msg (keys):', Object.keys(finishedMsg.raw).join(','), 'final_audio_proc_ms', finishedMsg.raw.final_audio_proc_ms, 'total', finishedMsg.raw.total_audio_proc_ms, 'audio sent ms', audioMs);
  // watermark behaviour: does final_audio_proc_ms advance during silence?
  const wm = r.msgs.filter((m) => typeof m.raw.final_audio_proc_ms === 'number').map((m) => [m.t, m.raw.final_audio_proc_ms]);
  console.log('watermark samples (arrival ms -> final_audio_proc_ms), every ~20th:', JSON.stringify(wm.filter((_, i) => i % 20 === 0).slice(0, 14)));
  const text = [...seenFinal].length ? r.msgs.flatMap((m) => (m.raw.tokens ?? []).filter((t: any) => t.is_final).map((t: any) => t.text)).join('') : '';
  console.log('final transcript head:', JSON.stringify(text.slice(0, 160)));
}

const what = process.argv[2] ?? 'english';
const fx = ensureFixture();
const speed = Number(process.env.PROBE_SPEED ?? 1);

if (what === 'english') {
  const r = await run(fx.pcm, { speed, endpoint: process.env.PROBE_ENDPOINT === '1', epDelay: Number(process.env.PROBE_EP_DELAY ?? 0) || undefined, finalizeEveryMs: Number(process.env.PROBE_FINALIZE_MS ?? 0) || undefined });
  analyze(`english 2-speaker 60 s at ${speed}x endpoint=${process.env.PROBE_ENDPOINT === '1'} finalizeEvery=${process.env.PROBE_FINALIZE_MS ?? 0}`, r, fx.durationMs);
} else if (what === 'header') {
  const r = await run(fx.pcm.subarray(0, CHUNK * 50), { mode: 'header', speed: 4 });
  console.log('header auth mode: tokens received =', r.cfgAccepted, 'close', r.closeCode);
} else if (what === 'multilang') {
  const es = sayClip('Monica', 'Buenos dias a todos. Hoy vamos a revisar los resultados del trimestre y decidir los proximos pasos.');
  const fr = sayClip('Thomas', 'Bonjour a tous. Aujourd hui nous allons examiner les resultats du trimestre et decider des prochaines etapes.');
  const en = sayClip('Samantha', 'Thanks everyone. Let us now switch back to English and summarise the decisions.');
  const gap = Buffer.alloc(16000 * 2 * 0.5);
  const pcm = Buffer.concat([es, gap, fr, gap, en]);
  const r = await run(pcm, { speed });
  analyze('multilingual es/fr/en, no hints', r, Math.round(pcm.length / 32));
} else if (what === 'cut') {
  const r = await run(fx.pcm, { speed, cutAtMs: 20_000 });
  console.log(`cut at 20 s: close code ${r.closeCode}, messages before cut ${r.msgs.length}`);
  const wm = r.msgs.filter((m) => typeof m.raw.final_audio_proc_ms === 'number').pop();
  console.log('last final_audio_proc_ms before cut:', wm?.raw.final_audio_proc_ms, 'last total:', wm?.raw.total_audio_proc_ms);
}

async function idleProbe(withKeepalive: boolean): Promise<void> {
  const KEEP = withKeepalive;
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(URL_, { headers: { Authorization: `Bearer ${KEY}` } });
    const t0 = Date.now();
    let timer: NodeJS.Timeout | undefined;
    ws.on('open', () => {
      ws.send(JSON.stringify(buildSonioxConfig({ model: 'stt-rt-v6', terms: [], languageHints: [], diarization: true })));
      ws.send(fx.pcm.subarray(0, CHUNK * 10)); // 2 s of audio, then silence on the wire
      if (KEEP) timer = setInterval(() => ws.send(JSON.stringify({ type: 'keepalive' })), 10_000);
      setTimeout(() => { if (ws.readyState === WebSocket.OPEN) { ws.send(''); } }, 45_000);
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.error_code !== undefined) console.log(`idle(keepalive=${KEEP}): error frame at ${Date.now() - t0} ms: code ${m.error_code} type ${m.error_type}`);
      if (m.finished) console.log(`idle(keepalive=${KEEP}): finished at ${Date.now() - t0} ms`);
    });
    ws.on('close', (c) => { if (timer) clearInterval(timer); console.log(`idle(keepalive=${KEEP}): closed ${c} at ${Date.now() - t0} ms`); resolve(); });
    ws.on('error', () => resolve());
  });
}

if (what === 'keepalive') {
  await Promise.all([idleProbe(true), idleProbe(false)]);
}

if (what === 'concurrency') {
  const N = Number(process.env.PROBE_STREAMS ?? 3); // keep <= 3: the key is shared with VoxKey production (limit 10)
  const rs = await Promise.all(Array.from({ length: N }, () => run(fx.pcm.subarray(0, CHUNK * 40), { speed: 4 })));
  console.log(`${N} concurrent streams: closes ${rs.map((r) => r.closeCode).join(',')} tokenStreams ${rs.map((r) => r.cfgAccepted).join(',')} errors ${rs.flatMap((r) => r.msgs.filter((m) => m.raw.error_code !== undefined).map((m) => m.raw.error_code + '/' + m.raw.error_type)).join(',') || 'none'}`);
}
