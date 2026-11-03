import { describe, expect, it } from 'vitest';
import { SpeakerMapper } from '../src/speakerMapper.js';

const alice = { id: '100', name: 'Alice', isHost: true };
const bob = { id: '200', name: 'Bob', isHost: false };
const on = (m: SpeakerMapper, p: typeof alice, relMs: number) => m.onSpeech({ on: true, participant: p, relMs });
const off = (m: SpeakerMapper, p: typeof alice, relMs: number) => m.onSpeech({ on: false, participant: p, relMs });

describe('SpeakerMapper', () => {
  it('maps a Soniox label to the participant whose speech window overlaps most', () => {
    const m = new SpeakerMapper();
    on(m, alice, 1000); off(m, alice, 4000);
    on(m, bob, 4500); off(m, bob, 7000);
    expect(m.resolve({ epoch: 0, label: '1', startMs: 1200, endMs: 3800 })).toMatchObject({ speakerId: '100', speakerName: 'Alice', isHost: true, mapped: true });
    expect(m.resolve({ epoch: 0, label: '2', startMs: 4600, endMs: 6900 })).toMatchObject({ speakerId: '200', speakerName: 'Bob', isHost: false, mapped: true });
  });
  it('tolerates speech_on lagging the real speech start', () => {
    const m = new SpeakerMapper({ toleranceMs: 500 });
    on(m, alice, 1300); off(m, alice, 3000); // Soniox segment starts at 1000
    expect(m.resolve({ epoch: 0, label: '1', startMs: 1000, endMs: 2900 }).speakerName).toBe('Alice');
  });
  it('uses cumulative votes so one noisy active-speaker event does not flip a label', () => {
    const m = new SpeakerMapper();
    on(m, alice, 0); off(m, alice, 10_000);
    for (let i = 0; i < 3; i++) m.resolve({ epoch: 0, label: '1', startMs: i * 3000, endMs: i * 3000 + 2500 });
    on(m, bob, 10_000); off(m, bob, 10_300); // a brief Bob blip, then the label speaks again
    on(m, alice, 11_000); off(m, alice, 14_000);
    expect(m.resolve({ epoch: 0, label: '1', startMs: 10_000, endMs: 10_400 }).speakerName).toBe('Alice');
  });
  it('keeps label namespaces per epoch (labels can be reassigned after a reconnect)', () => {
    const m = new SpeakerMapper();
    on(m, alice, 0); off(m, alice, 3000);
    on(m, bob, 3000); off(m, bob, 6000);
    expect(m.resolve({ epoch: 0, label: '1', startMs: 100, endMs: 2900 }).speakerName).toBe('Alice');
    expect(m.resolve({ epoch: 0, label: '2', startMs: 3100, endMs: 5900 }).speakerName).toBe('Bob');
    // epoch 1: Soniox swapped the numbering
    on(m, alice, 6000); off(m, alice, 9000);
    on(m, bob, 9000); off(m, bob, 12000);
    expect(m.resolve({ epoch: 1, label: '2', startMs: 6100, endMs: 8900 }).speakerName).toBe('Alice');
    expect(m.resolve({ epoch: 1, label: '1', startMs: 9100, endMs: 11900 }).speakerName).toBe('Bob');
  });
  it('falls back to "Speaker N" with a stable synthetic id when no events overlap', () => {
    const m = new SpeakerMapper();
    expect(m.resolve({ epoch: 0, label: '3', startMs: 0, endMs: 1000 })).toEqual({ speakerId: 'soniox-3', speakerName: 'Speaker 3', isHost: false, mapped: false });
  });
  it('treats a speech_on without speech_off as open until the segment end', () => {
    const m = new SpeakerMapper();
    on(m, bob, 500);
    expect(m.resolve({ epoch: 0, label: '1', startMs: 1000, endMs: 2000 }).speakerName).toBe('Bob');
  });
  it('uses a fallback name but keeps the participant id when Recall gives name null', () => {
    const m = new SpeakerMapper();
    const anon = { id: '300', name: null as unknown as string, isHost: false };
    on(m, anon, 0); off(m, anon, 2000);
    expect(m.resolve({ epoch: 0, label: '2', startMs: 100, endMs: 1900 })).toMatchObject({ speakerId: '300', speakerName: 'Speaker 2', mapped: true });
  });
  it('when two participants overlap the segment picks the larger overlap', () => {
    const m = new SpeakerMapper();
    on(m, alice, 0); off(m, alice, 1500);
    on(m, bob, 1000); off(m, bob, 5000);
    expect(m.resolve({ epoch: 0, label: '1', startMs: 1000, endMs: 4000 }).speakerName).toBe('Bob');
  });
  it('bounds memory: old windows are pruned', () => {
    const m = new SpeakerMapper({ maxWindowsPerParticipant: 50 });
    for (let i = 0; i < 10_000; i++) { on(m, alice, i * 100); off(m, alice, i * 100 + 50); }
    expect(m.windowCount()).toBeLessThanOrEqual(50);
  });
});
