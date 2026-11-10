import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A 60 s two-speaker test meeting: two macOS `say` voices (Samantha = Alice, Daniel = Bob) rendered to 16 kHz mono s16le WAV
 * and concatenated with short pauses, plus a ground-truth script (who says which word when). Where `say` does not exist (Linux CI)
 * a deterministic synthetic tone fallback with the same structure is used, so the harness still runs: the fake Soniox
 * never decodes audio, it only needs to know WHICH block of the reference it received.
 * Seeded dither (+-2 LSB) is added so every 200 ms block is unique (the fake identifies positions by block hash).
 */

export const SAMPLE_RATE = 16000;
export const TARGET_MS = 60_000;
export const PAUSE_MS = 400;

export type Who = 'alice' | 'bob';
export const PEOPLE: Record<Who, { id: string; name: string; isHost: boolean; voice: string }> = {
  alice: { id: '100', name: 'Alice Moreno', isHost: true, voice: 'Samantha' },
  bob: { id: '200', name: 'Bob Okafor', isHost: false, voice: 'Daniel' },
};

export interface ScriptWord { text: string; startMs: number; endMs: number }
export interface Utterance { who: Who; text: string; startMs: number; endMs: number; words: ScriptWord[] }
export interface Fixture { pcm: Buffer; utterances: Utterance[]; durationMs: number; synthetic: boolean }

const LINES: [Who, string][] = [
  ['alice', 'Good morning everyone, thanks for joining the weekly product review.'],
  ['bob', 'Morning Alice. I have the numbers from the new onboarding flow ready to share.'],
  ['alice', 'Great, please start with the activation rate and then the retention curve.'],
  ['bob', 'Activation went up from thirty one percent to thirty eight percent after the redesign.'],
  ['alice', 'That is a solid improvement. What about the seven day retention?'],
  ['bob', 'Retention is flat so far, but the sample is still small, about four hundred users.'],
  ['alice', 'Understood. Let us keep the experiment running for another two weeks.'],
  ['bob', 'Agreed. I will also add the live transcript feature to the survey.'],
  ['alice', 'Perfect. Any blockers on the engineering side before the release on Friday?'],
  ['bob', 'Only the Android build signing, which should be resolved by tomorrow afternoon.'],
  ['alice', 'Thank you Bob. Please send a short summary to the team after this call.'],
  ['bob', 'Will do. I will include the action items and the owners for each of them.'],
  ['alice', 'Excellent, that covers everything for today. Have a great week everybody.'],
  ['bob', 'Thanks all, talk to you next week.'],
];

function parseWav(buf: Buffer): Buffer {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a WAV');
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, size > 0 && off + 8 + size <= buf.length ? off + 8 + size : buf.length);
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function wavFile(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function haveSay(): boolean {
  try { execFileSync('say', ['-v', '?'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function sayPcm(voice: string, text: string, dir: string, i: number): Buffer {
  const out = join(dir, `u${i}.wav`);
  execFileSync('say', ['-v', voice, '--file-format=WAVE', '--data-format=LEI16@16000', '-o', out, text]);
  return parseWav(readFileSync(out));
}

function tonePcm(who: Who, text: string): Buffer {
  const words = text.split(/\s+/).length;
  const n = Math.round(words * 0.38 * SAMPLE_RATE);
  const f = who === 'alice' ? 220 : 140;
  const b = Buffer.alloc(n * 2);
  for (let k = 0; k < n; k++) {
    const env = 0.5 + 0.5 * Math.sin((2 * Math.PI * k) / (SAMPLE_RATE * 0.38));
    b.writeInt16LE(Math.round(6000 * env * Math.sin((2 * Math.PI * f * k) / SAMPLE_RATE)), k * 2);
  }
  return b;
}

function mulberry32(a: number): () => number {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function buildFixture(): Fixture {
  const synthetic = !haveSay();
  const dir = mkdtempSync(join(tmpdir(), 'mm-live-stt-fx-'));
  try {
    const parts: Buffer[] = [];
    const utterances: Utterance[] = [];
    let ms = 0;
    const silence = (n: number) => Buffer.alloc(Math.round((n / 1000) * SAMPLE_RATE) * 2);
    let i = 0;
    for (const [who, text] of LINES) {
      const pcm = synthetic ? tonePcm(who, text) : sayPcm(PEOPLE[who].voice, text, dir, i);
      const dur = Math.round((pcm.length / 2 / SAMPLE_RATE) * 1000);
      if (ms + dur > TARGET_MS - 200) break;
      const toks = text.split(/\s+/);
      const total = toks.reduce((n, w) => n + w.length + 1, 0);
      let acc = 0;
      const words: ScriptWord[] = toks.map((w) => {
        const s = ms + Math.round((acc / total) * dur);
        acc += w.length + 1;
        return { text: w, startMs: s, endMs: ms + Math.round((acc / total) * dur) - 40 };
      });
      utterances.push({ who, text, startMs: ms, endMs: ms + dur, words });
      parts.push(pcm, silence(PAUSE_MS));
      ms += dur + PAUSE_MS;
      i++;
    }
    let pcm = Buffer.concat(parts);
    const want = Math.round((TARGET_MS / 1000) * SAMPLE_RATE) * 2;
    pcm = pcm.length >= want ? pcm.subarray(0, want) : Buffer.concat([pcm, Buffer.alloc(want - pcm.length)]);
    pcm = Buffer.from(pcm); // own the memory
    const rnd = mulberry32(1234);
    for (let o = 0; o < pcm.length; o += 2) {
      const v = pcm.readInt16LE(o) + Math.floor(rnd() * 5) - 2;
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, v)), o);
    }
    return { pcm, utterances, durationMs: TARGET_MS, synthetic };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function fixtureDir(): string {
  return join(import.meta.dirname, '..', '.fixtures');
}

/** Generates (once) and returns the fixture. The WAV is written for listening; the JSON holds the ground truth. */
export function ensureFixture(): Fixture {
  const dir = fixtureDir();
  const wav = join(dir, 'meeting60.wav');
  const script = join(dir, 'meeting60.json');
  if (!existsSync(wav) || !existsSync(script)) {
    mkdirSync(dir, { recursive: true });
    const fx = buildFixture();
    writeFileSync(wav, wavFile(fx.pcm));
    writeFileSync(script, JSON.stringify({ utterances: fx.utterances, durationMs: fx.durationMs, synthetic: fx.synthetic }));
  }
  const meta = JSON.parse(readFileSync(script, 'utf8')) as { utterances: Utterance[]; durationMs: number; synthetic: boolean };
  return { pcm: parseWav(readFileSync(wav)), utterances: meta.utterances, durationMs: meta.durationMs, synthetic: meta.synthetic };
}
