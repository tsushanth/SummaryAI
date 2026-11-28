import { describe, it, expect } from 'vitest';
import { endsMidSentence, joinTranscript } from '../src/services/coachingTranscript.js';

const line = (segment_text: string, speaker_name: string | null = 'A') => ({ speaker_name, segment_text });

describe('endsMidSentence', () => {
  it('knows a line that stops where more is coming', () => {
    for (const t of ['the most we can spend is about', 'we would describe it as', 'it needs to be', 'we looked at it and,', 'Our deadline is the...']) expect(endsMidSentence(t), t).toBe(true);
    for (const t of ['two thousand a year', 'it crashes', 'we need a shared calendar', 'who is it for?', 'Alaska', 'that is the data.']) expect(endsMidSentence(t), t).toBe(false);
  });
});

describe('joinTranscript', () => {
  it('joins consecutive lines of one speaker and keeps the turns apart', () => {
    expect(joinTranscript([line('the most we can spend is about'), line('two thousand'), line('sure', 'B'), line(' ', 'B'), line('another', null)]))
      .toBe('[A]: the most we can spend is about two thousand\n[B]: sure\n[Speaker]: another');
  });
  it('drops the oldest lines, whole, past the length limit', () => {
    expect(joinTranscript([line('first words'), line('second words'), line('third words')], 26)).toBe('[A]: second words third words');
  });
  it('always keeps the newest line', () => {
    expect(joinTranscript([line('old'), line('a single very long newest line')], 5)).toBe('[A]: a single very long newest line');
  });
  it('is empty for no lines', () => {
    expect(joinTranscript([])).toBe('');
  });
});
