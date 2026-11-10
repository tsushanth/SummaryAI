import { describe, expect, it } from 'vitest';
import { ReplayBuffer } from '../src/audio/replayBuffer.js';

const chunk = (i: number) => ({ relMs: i * 200, durMs: 200, pcm: Buffer.alloc(6400) });

describe('ReplayBuffer', () => {
  it('retains about retainMs of sent audio and trims older sent chunks', () => {
    const b = new ReplayBuffer({ retainMs: 10_000, hardCapMs: 60_000 });
    for (let i = 0; i < 200; i++) { b.push(chunk(i)); b.markSent(chunk(i).relMs + 200); }
    expect(b.durationMs()).toBeGreaterThanOrEqual(10_000);
    expect(b.durationMs()).toBeLessThanOrEqual(10_200);
  });
  it('keeps unsent chunks past retainMs (during an outage) up to hardCapMs', () => {
    const b = new ReplayBuffer({ retainMs: 10_000, hardCapMs: 30_000 });
    for (let i = 0; i < 100; i++) b.push(chunk(i)); // 20 s unsent
    expect(b.durationMs()).toBe(20_000);
    expect(b.lostMs()).toBe(0);
  });
  it('drops oldest unsent audio beyond hardCapMs and counts it as lost', () => {
    const b = new ReplayBuffer({ retainMs: 10_000, hardCapMs: 30_000 });
    for (let i = 0; i < 300; i++) b.push(chunk(i)); // 60 s unsent
    expect(b.durationMs()).toBeLessThanOrEqual(30_000);
    expect(b.lostMs()).toBeGreaterThanOrEqual(29_800);
    expect(b.bytes()).toBeLessThanOrEqual(30_000 * 32);
  });
  it('chunksFrom returns chunks that end after the given time', () => {
    const b = new ReplayBuffer({ retainMs: 10_000, hardCapMs: 60_000 });
    for (let i = 0; i < 10; i++) b.push(chunk(i));
    expect(b.chunksFrom(1000).map((c) => c.relMs)).toEqual([1000, 1200, 1400, 1600, 1800]);
    expect(b.chunksFrom(5000)).toEqual([]);
  });
  it('earliestMs/newestEndMs', () => {
    const b = new ReplayBuffer({ retainMs: 10_000, hardCapMs: 60_000 });
    expect(b.earliestMs()).toBeNull();
    b.push(chunk(3)); b.push(chunk(4));
    expect(b.earliestMs()).toBe(600);
    expect(b.newestEndMs()).toBe(1000);
  });
});
