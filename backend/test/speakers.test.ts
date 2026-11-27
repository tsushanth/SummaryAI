// Speaker numbering: stored data counts from 0 and is never rewritten, people read numbers from 1.
import { describe, it, expect } from 'vitest';
import {
  displaySpeakerText,
  speakerDisplayName,
  displaySummary,
  speakersForSummary,
  withDisplaySpeakers,
} from '../src/lib/speakers.js';
import { computeMeetingAnalytics } from '../src/services/meetingAnalytics.js';

// The same display cases as web scripts/export.test.mjs and Android SpeakerNamesTest.
describe('displaySpeakerText', () => {
  it('names the stored index and counts the unnamed from 1', () => {
    expect(displaySpeakerText('Assigned to Speaker 1')).toBe('Assigned to Speaker 2');
    expect(displaySpeakerText('Speaker 0 asked Speaker 1.', { '0': 'Alex' })).toBe('Alex asked Speaker 2.');
    expect(displaySpeakerText('Speaker 1 (Blake) will send it', { '1': 'Blake' })).toBe('Blake will send it');
    expect(displaySpeakerText('Speaker 0', { '0': '  ' })).toBe('Speaker 1');
  });

  it('handles lists and recordings transcribed in parts', () => {
    expect(displaySpeakerText('Speakers 0 and 1 agreed.')).toBe('Speakers 1 and 2 agreed.');
    expect(displaySpeakerText('Speakers 0, 1, and 2 met.', {})).toBe('Speakers 1, 2, and 3 met.');
    expect(displaySpeakerText('Speakers 0 and 1 agreed.', { '0': 'Ana' })).toBe('Ana and Speaker 2 agreed.');
    expect(displaySpeakerText('Part 2 speaker 0 left.', { '0': 'Ana' })).toBe('Part 2 speaker 1 left.');
  });
});

describe('speakerDisplayName', () => {
  it('counts generated labels from 1 and keeps real ones', () => {
    expect(speakerDisplayName('Speaker 0', 0)).toBe('Speaker 1');
    expect(speakerDisplayName('Speaker 1', 1, { '1': 'Blake' })).toBe('Blake');
    expect(speakerDisplayName('Speaker 1', 1, { '0': 'Alex' })).toBe('Speaker 2');
    expect(speakerDisplayName('Jordan Lee', 0)).toBe('Jordan Lee');
    expect(speakerDisplayName('Speaker 100', 0)).toBe('Speaker 100');
    expect(speakerDisplayName('Speaker 1', 0)).toBe('Speaker 1');
    expect(speakerDisplayName('Part 1 speaker 0', 0)).toBe('Part 1 speaker 1');
    expect(speakerDisplayName(undefined, 2)).toBe('Speaker 3');
  });
});

describe('displaySummary', () => {
  it('covers every text column and leaves the stored row untouched', () => {
    const row = {
      summary: 'Speaker 0 opened.',
      detailed_summary: null,
      key_points: ['Speaker 1 agreed'],
      action_items: ['Speaker 0: send', { task: 'Reply to Speaker 0', title: 'Reply to Speaker 0', assignee: 'Speaker 1', priority: 'low' }],
      topics: ['budget'],
    };
    const copy = JSON.parse(JSON.stringify(row));
    expect(displaySummary(row, { '1': 'Blake' })).toEqual({
      summary: 'Speaker 1 opened.',
      detailed_summary: null,
      key_points: ['Blake agreed'],
      action_items: ['Speaker 1: send', { task: 'Reply to Speaker 1', title: 'Reply to Speaker 1', assignee: 'Blake', priority: 'low' }],
      topics: ['budget'],
    });
    expect(row).toEqual(copy);
  });
});

describe('speakersForSummary', () => {
  const stored = [
    { speaker_label: 'Speaker 0', speaker_index: 0 },
    { speaker_label: 'Speaker 1', speaker_index: 1 },
  ];

  it('shows the model numbers from 1 and puts its mentions back into the stored numbering', () => {
    const { segments, restore } = speakersForSummary(stored);
    expect(segments.map((s) => s.speaker_label)).toEqual(['Speaker 1', 'Speaker 2']);
    expect(stored[0]!.speaker_label).toBe('Speaker 0');
    const reply = 'Speaker 1 asked Speaker 2. Speakers 1 and 2 agreed.';
    expect(restore(reply)).toBe('Speaker 0 asked Speaker 1. Speakers 0 and 1 agreed.');
    // So what a person reads is what the model wrote.
    expect(displaySpeakerText(restore(reply))).toBe(reply);
  });

  it('changes only the numbers it handed out', () => {
    expect(speakersForSummary(stored).restore('Speaker 7 was mentioned, speaker 0 too.')).toBe('Speaker 7 was mentioned, speaker 0 too.');
  });

  it('leaves names and participant ids alone both ways', () => {
    const named = [
      { speaker_label: 'Jordan Lee', speaker_index: 0 },
      { speaker_label: 'Speaker 100', speaker_index: 1 },
    ];
    const { segments, restore } = speakersForSummary(named);
    expect(segments).toEqual(named);
    expect(restore('Speaker 100 and Speaker 1')).toBe('Speaker 100 and Speaker 1');
  });

  it('counts the parts of a long recording from 1', () => {
    const { segments, restore } = speakersForSummary([{ speaker_label: 'Part 2 speaker 0', speaker_index: 2 }]);
    expect(segments[0]!.speaker_label).toBe('Part 2 speaker 1');
    expect(restore('Part 2 speaker 1 agreed.')).toBe('Part 2 speaker 0 agreed.');
  });
});

describe('segments for answers read straight by a person', () => {
  it('carry the owner\'s names, else numbers from 1', () => {
    const out = withDisplaySpeakers(
      [
        { speaker_label: 'Speaker 0', speaker_index: 0 },
        { speaker_label: 'Speaker 1', speaker_index: 1 },
      ],
      { '0': 'Alex' }
    );
    expect(out.map((s) => s.speaker_label)).toEqual(['Alex', 'Speaker 2']);
  });
});

describe('talk time', () => {
  it('names speakers from 1', () => {
    const a = computeMeetingAnalytics(
      [
        { speaker_label: 'Speaker 0', speaker_index: 0, text: 'a b c', start_time: 0, end_time: 9 },
        { speaker_label: 'Speaker 1', speaker_index: 1, text: 'd', start_time: 10, end_time: 11 },
      ],
      { '1': 'Blake' }
    );
    expect(a.speakers.map((s) => s.name)).toEqual(['Speaker 1', 'Blake']);
    expect(a.longest_monologue_speaker).toBe('Speaker 1');
  });
});
