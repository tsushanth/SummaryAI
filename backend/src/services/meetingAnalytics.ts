/**
 * Meeting analytics (talk time, word counts, monologue, questions).
 * Pure functions over transcript segments so they are easy to test.
 */

export interface AnalyticsSegment {
  speaker_label?: string;
  speaker_index?: number;
  text?: string;
  start_time?: number;
  end_time?: number;
}

export interface SpeakerStats {
  speaker_index: number;
  name: string;
  talk_time_seconds: number;
  talk_share: number; // 0..1
  word_count: number;
  question_count: number;
  longest_monologue_seconds: number;
}

export interface MeetingAnalytics {
  speakers: SpeakerStats[];
  total_talk_seconds: number;
  total_words: number;
  total_questions: number;
  longest_monologue_seconds: number;
  longest_monologue_speaker: string | null;
  /** 'time' when derived from timestamps, 'words' when timestamps were unusable */
  basis: 'time' | 'words';
}

/** Adjacent same-speaker segments closer than this are one continuous monologue. */
const MONOLOGUE_GAP_SECONDS = 2;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** Count question marks (runs like "?!?" count once). */
export function countQuestions(text: string): number {
  const m = text.match(/\?+/g);
  return m ? m.length : 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Acc extends SpeakerStats {
  label: string;
}

export function computeMeetingAnalytics(
  segments: AnalyticsSegment[] | null | undefined,
  speakerNames: Record<string, string> | null | undefined = {}
): MeetingAnalytics {
  const segs = (segments ?? []).filter((s) => s && typeof s.text === 'string');
  const names = speakerNames ?? {};
  const bySpeaker = new Map<number, Acc>();
  const idxOf = (s: AnalyticsSegment) => (Number.isFinite(s.speaker_index) ? (s.speaker_index as number) : 0);

  const statFor = (idx: number, label: string) => {
    let s = bySpeaker.get(idx);
    if (!s) {
      s = {
        speaker_index: idx,
        label,
        name: names[String(idx)] || label,
        talk_time_seconds: 0,
        talk_share: 0,
        word_count: 0,
        question_count: 0,
        longest_monologue_seconds: 0,
      };
      bySpeaker.set(idx, s);
    }
    return s;
  };

  let anyTimed = false;
  for (const seg of segs) {
    const idx = idxOf(seg);
    const s = statFor(idx, seg.speaker_label || `Speaker ${idx + 1}`);
    const dur = Math.max(0, (seg.end_time ?? 0) - (seg.start_time ?? 0));
    if (dur > 0) anyTimed = true;
    s.talk_time_seconds += dur;
    s.word_count += countWords(seg.text!);
    s.question_count += countQuestions(seg.text!);
  }

  // Monologues: merge consecutive same-speaker segments separated by a small gap.
  let overallLongest = 0;
  let overallSpeaker: number | null = null;
  let runSpeaker: number | null = null;
  let runStart = 0;
  let runEnd = 0;
  const flush = () => {
    if (runSpeaker === null) return;
    const len = runEnd - runStart;
    const s = bySpeaker.get(runSpeaker)!;
    if (len > s.longest_monologue_seconds) s.longest_monologue_seconds = len;
    if (len > overallLongest) {
      overallLongest = len;
      overallSpeaker = runSpeaker;
    }
  };
  const ordered = [...segs].sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));
  for (const seg of ordered) {
    const idx = idxOf(seg);
    const start = seg.start_time ?? 0;
    const end = seg.end_time ?? start;
    if (runSpeaker === idx && start - runEnd <= MONOLOGUE_GAP_SECONDS) {
      runEnd = Math.max(runEnd, end);
    } else {
      flush();
      runSpeaker = idx;
      runStart = start;
      runEnd = end;
    }
  }
  flush();

  const accs = [...bySpeaker.values()];
  const totalTime = accs.reduce((a, s) => a + s.talk_time_seconds, 0);
  const totalWords = accs.reduce((a, s) => a + s.word_count, 0);
  const basis: 'time' | 'words' = anyTimed && totalTime > 0 ? 'time' : 'words';
  for (const s of accs) {
    s.talk_share =
      basis === 'time' ? s.talk_time_seconds / totalTime : totalWords > 0 ? s.word_count / totalWords : 0;
  }
  accs.sort((a, b) => b.talk_share - a.talk_share);

  return {
    speakers: accs.map((s) => ({
      speaker_index: s.speaker_index,
      name: s.name,
      talk_time_seconds: round1(s.talk_time_seconds),
      talk_share: Math.round(s.talk_share * 1000) / 1000,
      word_count: s.word_count,
      question_count: s.question_count,
      longest_monologue_seconds: round1(s.longest_monologue_seconds),
    })),
    total_talk_seconds: round1(totalTime),
    total_words: totalWords,
    total_questions: accs.reduce((a, s) => a + s.question_count, 0),
    longest_monologue_seconds: round1(overallLongest),
    longest_monologue_speaker: overallSpeaker === null ? null : bySpeaker.get(overallSpeaker)!.name,
    basis,
  };
}
