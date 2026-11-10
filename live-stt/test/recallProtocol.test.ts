import { describe, expect, it } from 'vitest';
import { parseRecallMessage } from '../src/recall/protocol.js';

const pcm = Buffer.alloc(6400, 1); // 200 ms of 16 kHz s16le mono
const audioMsg = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: 'audio_mixed_raw.data',
    data: {
      data: { buffer: pcm.toString('base64'), timestamp: { relative: 12.4, absolute: '2026-11-03T10:00:12.400000Z' } },
      realtime_endpoint: { id: 'ep', metadata: {} },
      audio_mixed: { id: 'am', metadata: {} },
      recording: { id: 'rec', metadata: {} },
      bot: { id: 'bot-123', metadata: {} },
      ...over,
    },
  });

describe('parseRecallMessage', () => {
  it('parses audio_mixed_raw.data (documented shape)', () => {
    const m = parseRecallMessage(audioMsg());
    expect(m.kind).toBe('audio');
    if (m.kind !== 'audio') return;
    expect(m.botId).toBe('bot-123');
    expect(m.relMs).toBe(12400);
    expect(m.durMs).toBe(200);
    expect(m.pcm.length).toBe(6400);
  });
  it('treats an empty buffer (unmuted but silent participant) as an empty audio packet', () => {
    const m = parseRecallMessage(JSON.stringify({ event: 'audio_mixed_raw.data', data: { data: { buffer: '', timestamp: { relative: 1 } }, bot: { id: 'b' } } }));
    expect(m).toMatchObject({ kind: 'empty' });
  });
  it('rejects odd-length PCM, bad base64 and missing timestamp', () => {
    const odd = JSON.stringify({ event: 'audio_mixed_raw.data', data: { data: { buffer: Buffer.alloc(3).toString('base64'), timestamp: { relative: 1 } }, bot: { id: 'b' } } });
    expect(parseRecallMessage(odd).kind).toBe('invalid');
    const noTs = JSON.stringify({ event: 'audio_mixed_raw.data', data: { data: { buffer: pcm.toString('base64') }, bot: { id: 'b' } } });
    expect(parseRecallMessage(noTs).kind).toBe('invalid');
    const bad = JSON.stringify({ event: 'audio_mixed_raw.data', data: { data: { buffer: '***not base64***', timestamp: { relative: 1 } }, bot: { id: 'b' } } });
    expect(parseRecallMessage(bad).kind).toBe('invalid');
  });
  it('parses participant speech_on / speech_off', () => {
    const ev = (event: string) => JSON.stringify({
      event,
      data: { data: { participant: { id: 100, name: 'Alice', is_host: true, platform: 'google_meet', extra_data: null, email: null }, timestamp: { absolute: 'x', relative: 3.25 }, data: null }, bot: { id: 'bot-123' } },
    });
    expect(parseRecallMessage(ev('participant_events.speech_on'))).toMatchObject({
      kind: 'speech', on: true, relMs: 3250, botId: 'bot-123', participant: { id: '100', name: 'Alice', isHost: true },
    });
    expect(parseRecallMessage(ev('participant_events.speech_off'))).toMatchObject({ kind: 'speech', on: false });
  });
  it('ignores other documented events and rejects garbage', () => {
    expect(parseRecallMessage(JSON.stringify({ event: 'participant_events.join', data: {} }))).toEqual({ kind: 'ignored', event: 'participant_events.join' });
    expect(parseRecallMessage('not json').kind).toBe('invalid');
    expect(parseRecallMessage('[]').kind).toBe('invalid');
    expect(parseRecallMessage(JSON.stringify({ nope: 1 })).kind).toBe('invalid');
  });
  it('rejects oversized audio payloads', () => {
    const big = Buffer.alloc(400_000).toString('base64');
    expect(parseRecallMessage(JSON.stringify({ event: 'audio_mixed_raw.data', data: { data: { buffer: big, timestamp: { relative: 1 } }, bot: { id: 'b' } } })).kind).toBe('invalid');
  });
});
