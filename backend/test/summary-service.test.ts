import { describe, it, expect } from 'vitest';
import { buildSummaryPrompts, normalizeActionItems, parseSummaryResponse } from '../src/services/summaryService.js';
import { resolveSummaryTemplate } from '../src/services/summaryTemplates.js';

describe('normalizeActionItems', () => {
  it('emits both task and title and defaults', () => {
    expect(normalizeActionItems([{ task: ' Send deck ', assignee: 'null', priority: 'HIGH' }])).toEqual([
      { task: 'Send deck', title: 'Send deck', assignee: null, priority: 'high', due_date: null },
    ]);
  });

  it('accepts legacy title-only objects and bare strings, drops empties', () => {
    const out = normalizeActionItems([{ title: 'A', assignee: 'Sam', due_date: '2026-10-20' }, 'B', '', { task: 5 }, null]);
    expect(out.map((i) => i.task)).toEqual(['A', 'B']);
    expect(out[0]).toMatchObject({ assignee: 'Sam', due_date: '2026-10-20', priority: 'medium' });
  });

  it('returns [] for non-arrays', () => {
    expect(normalizeActionItems(undefined)).toEqual([]);
    expect(normalizeActionItems({})).toEqual([]);
  });
});

describe('parseSummaryResponse', () => {
  it('parses fenced JSON', () => {
    const r = parseSummaryResponse('```json\n{"summary":"S","key_points":["a"],"action_items":[{"task":"t"}],"topics":["x"]}\n```');
    expect(r.summary).toBe('S');
    expect(r.keyPoints).toEqual(['a']);
    expect(r.actionItems[0].title).toBe('t');
    expect(r.topics).toEqual(['x']);
  });

  it('falls back to plain text on invalid JSON', () => {
    const r = parseSummaryResponse('not json');
    expect(r).toEqual({ summary: 'not json', keyPoints: [], actionItems: [], topics: [] });
  });

  it('ignores non-string key points', () => {
    expect(parseSummaryResponse('{"summary":"S","key_points":[1,"ok"]}').keyPoints).toEqual(['ok']);
  });
});

describe('buildSummaryPrompts', () => {
  it('includes the template instructions and language', () => {
    const p = buildSummaryPrompts({ templateId: 'standup', transcriptText: 'T', speakers: ['A', 'B'], languageName: 'Spanish' });
    expect(p.template.id).toBe('standup');
    expect(p.user).toContain('Blockers');
    expect(p.user).toContain('Participants: A, B');
    expect(p.user).toContain('Spanish');
    expect(p.system).toContain('Spanish');
  });

  it('falls back to general for unknown template ids', () => {
    expect(buildSummaryPrompts({ templateId: 'nope', transcriptText: 'T', speakers: [] }).template.id).toBe('general');
  });
});

describe('resolveSummaryTemplate', () => {
  it('prefers the recording template, then the recording type', () => {
    expect(resolveSummaryTemplate({ recordingTemplate: 'sales_call', recordingType: 'lecture' })).toBe('sales_call');
    expect(resolveSummaryTemplate({ recordingTemplate: null, recordingType: 'lecture' })).toBe('lecture');
    expect(resolveSummaryTemplate({ recordingTemplate: 'bogus', recordingType: 'meeting' })).toBe('general');
  });
});
