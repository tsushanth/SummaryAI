// Unit tests for the pure export formatters. Run: npm run test:export
// Node strips the TypeScript types on import (Node >= 22.18).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySpeakerNames,
  summaryMarkdown,
  transcriptMarkdown,
  liveTranscriptMarkdown,
  audioExtensionFor,
  audioDownloadUrl,
  markdownToPlainText,
  safeFileName,
  DEFAULT_EXPORT_OPTIONS,
} from '../src/lib/exportFormats.ts';

const rec = { title: 'Weekly Sync' };
const summary = {
  summary: 'Speaker 1 led the call.',
  detailed_summary: 'Speaker 2 raised budget concerns.',
  key_points: ['Speaker 1 wants speed'],
  action_items: [{ text: 'Send deck', assignee: 'Speaker 2' }, { text: 'Book room', assignee: null }],
  topics: ['budget', 'launch'],
};
const names = { 1: 'Ana', 2: '  ' };
const transcript = {
  speaker_names: { 0: 'Ana' },
  segments: [
    { speaker_label: 'Speaker 1', speaker_index: 0, text: 'Hi, Speaker 1 here', start_time: 65.9 },
    { speaker_label: 'Speaker 2', speaker_index: 1, text: 'Hello', start_time: 3 },
  ],
};
const off = { includeSpeakerNames: false, includeTimestamps: false, includeActionItems: false };

test('applySpeakerNames ignores blank names and missing map', () => {
  assert.equal(applySpeakerNames('Speaker 1 / Speaker 2', names), 'Ana / Speaker 2');
  assert.equal(applySpeakerNames('Speaker 1', null), 'Speaker 1');
});

test('summaryMarkdown includes detailed summary, actions and names by default', () => {
  const md = summaryMarkdown(rec, summary, names);
  assert.match(md, /^# Weekly Sync\n\n## Summary\nAna led the call\.\n\nSpeaker 2 raised budget concerns\./);
  assert.match(md, /• Send deck \(Speaker 2\)/);
  assert.match(md, /## Topics\nbudget, launch\n$/);
});

test('summaryMarkdown honours options and omits absent detailed summary', () => {
  const md = summaryMarkdown(rec, { ...summary, detailed_summary: null }, names, off);
  assert.ok(md.includes('Speaker 1 led the call.'));
  assert.ok(!md.includes('Action Items'));
  assert.ok(!md.includes('budget concerns'));
});

test('transcriptMarkdown formats timestamps and names', () => {
  const md = transcriptMarkdown(rec, transcript, DEFAULT_EXPORT_OPTIONS);
  assert.ok(md.includes('[01:05] Ana: Hi, Speaker 1 here'));
  assert.ok(md.includes('[00:03] Speaker 2: Hello'));
});

test('transcriptMarkdown options strip timestamps and names', () => {
  const md = transcriptMarkdown(rec, transcript, { ...off });
  assert.ok(md.includes('Speaker 1: Hi, Speaker 1 here'));
  assert.ok(!md.includes('['));
});

test('liveTranscriptMarkdown matches the Android layout', () => {
  const live = {
    word_count: 12,
    speaker_count: 2,
    segments: [{ speaker_label: 'Bob', text: 'Hey', start_time: 125 }],
  };
  const md = liveTranscriptMarkdown(rec, live);
  assert.equal(
    md,
    '# Weekly Sync - Live Transcript\n\n_Captured live during the meeting. 12 words, 2 speakers._\n\n[02:05] Bob: Hey\n'
  );
  assert.ok(liveTranscriptMarkdown(rec, live, off).includes('\nBob: Hey'));
});

test('audioExtensionFor ignores JWT dots in the query', () => {
  assert.equal(audioExtensionFor('https://x.co/a/b/rec.MP3?token=eyJ.abc.def'), 'mp3');
  assert.equal(audioExtensionFor('https://x.co/a/b/rec?token=eyJ.abc.def', 'audio/mpeg; charset=x'), 'mp3');
  assert.equal(audioExtensionFor('https://x.co/a/b/rec', null), 'm4a');
  assert.equal(audioExtensionFor('https://x.co/a.b/rec', 'audio/wav'), 'wav');
});

test('audioDownloadUrl preserves the token and sets download', () => {
  const u = new URL(audioDownloadUrl('https://x.co/object/sign/a/b.m4a?token=abc', 'My Rec.m4a'));
  assert.equal(u.searchParams.get('token'), 'abc');
  assert.equal(u.searchParams.get('download'), 'My Rec.m4a');
});

test('plain text and file name helpers', () => {
  assert.equal(markdownToPlainText('# A\n## B\ntext'), 'A\nB\ntext');
  assert.equal(safeFileName('a/b:c*'), 'a-b-c-');
  assert.equal(safeFileName('  '), 'Recording');
});
