import type { Participant } from './recall/protocol.js';

/**
 * Maps Soniox diarization labels ("1", "2", ...) to meeting participants using Recall's participant_events.speech_on/off.
 * Recall itself calls active-speaker events "sometimes inaccurate" and speech_on can lag, so:
 *   - windows are padded by toleranceMs,
 *   - each (epoch, label) keeps cumulative overlap votes per participant and the best-voted participant wins (a brief wrong
 *     event cannot flip a label that has been Alice for a minute),
 *   - labels are namespaced by epoch because Soniox can renumber speakers after a reconnect or rollover,
 *   - no overlapping events at all -> "Speaker N" with a synthetic id.
 */

export interface SpeakerMapperOptions {
  toleranceMs?: number;
  maxWindowsPerParticipant?: number;
  maxLabels?: number;
}

interface Win { on: number; off: number | null }

export interface ResolveInput { epoch: number; label: string; startMs: number; endMs: number }
export interface Resolved { speakerId: string; speakerName: string; isHost: boolean; mapped: boolean }

export class SpeakerMapper {
  private readonly tol: number;
  private readonly maxWin: number;
  private readonly maxLabels: number;
  private readonly people = new Map<string, Participant>();
  private readonly windows = new Map<string, Win[]>();
  private readonly votes = new Map<string, Map<string, number>>();

  constructor(o: SpeakerMapperOptions = {}) {
    this.tol = o.toleranceMs ?? 400;
    this.maxWin = o.maxWindowsPerParticipant ?? 500;
    this.maxLabels = o.maxLabels ?? 200;
  }

  onSpeech(ev: { on: boolean; participant: Participant; relMs: number }): void {
    const id = ev.participant.id;
    this.people.set(id, ev.participant);
    let w = this.windows.get(id);
    if (!w) { w = []; this.windows.set(id, w); }
    if (ev.on) {
      const open = w[w.length - 1];
      if (!open || open.off !== null) w.push({ on: ev.relMs, off: null });
    } else {
      const open = w[w.length - 1];
      if (open && open.off === null) open.off = Math.max(ev.relMs, open.on);
      else w.push({ on: Math.max(0, ev.relMs - 1), off: ev.relMs });
    }
    if (w.length > this.maxWin) w.splice(0, w.length - this.maxWin);
  }

  windowCount(): number {
    let n = 0;
    for (const w of this.windows.values()) n += w.length;
    return n;
  }

  resolve(seg: ResolveInput): Resolved {
    const key = `${seg.epoch}:${seg.label}`;
    let tally = this.votes.get(key);
    if (!tally) {
      if (this.votes.size >= this.maxLabels) this.votes.delete(this.votes.keys().next().value as string);
      tally = new Map();
      this.votes.set(key, tally);
    }
    for (const [id, wins] of this.windows) {
      let ov = 0;
      for (const w of wins) {
        const a = Math.max(seg.startMs, w.on - this.tol);
        const b = Math.min(seg.endMs, (w.off ?? seg.endMs) + this.tol);
        if (b > a) ov += b - a;
      }
      if (ov > 0) tally.set(id, (tally.get(id) ?? 0) + ov);
    }
    let bestId: string | null = null;
    let best = 0;
    for (const [id, v] of tally) if (v > best) { best = v; bestId = id; }
    if (bestId === null) {
      return { speakerId: `soniox-${seg.label}`, speakerName: `Speaker ${seg.label}`, isHost: false, mapped: false };
    }
    const p = this.people.get(bestId)!;
    return { speakerId: p.id, speakerName: p.name ?? `Speaker ${seg.label}`, isHost: p.isHost, mapped: true };
  }
}
