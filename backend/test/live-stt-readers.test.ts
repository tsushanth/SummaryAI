import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Guard: every READ of live_transcripts must exclude shadow rows. Shadow rows are the Soniox side of an A/B comparison and must
// never reach clients, live insights, coaching, Q&A or the stitched transcript. A new reader added later without the filter fails here.
const SRC = join(__dirname, '..', 'src');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('live_transcripts readers exclude shadow rows', () => {
  const found: Array<{ file: string; line: number; chain: string }> = [];
  for (const file of walk(SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!/\.from\('live_transcripts'\)/.test(l)) return;
      const chain = lines.slice(i, i + 12).join('\n').split(/;\s*$/m)[0]!;
      found.push({ file: file.slice(SRC.length + 1), line: i + 1, chain });
    });
  }
  const reads = found.filter((f) => /\.select\(/.test(f.chain) && !/\.(insert|upsert)\(/.test(f.chain));
  const writes = found.filter((f) => /\.(insert|upsert)\(/.test(f.chain));

  it('finds the six known readers and the two writers', () => {
    expect(reads.map((r) => r.file).sort()).toEqual([
      'routes/meetings.ts', 'routes/questions.ts', 'services/coachingService.ts', 'services/liveInsightsService.ts', 'services/stuckMeetingRecovery.ts', 'services/voiceAssistant/runtime.ts',
    ]);
    expect(writes.map((r) => r.file).sort()).toEqual(['routes/liveSegments.ts', 'routes/webhooks.ts']);
  });
  it.each(reads.map((r) => [r.file, r] as const))('%s filters shadow=false', (_f, r) => {
    expect(r.chain).toMatch(/\.eq\('shadow', false\)/);
    expect(r.chain).toMatch(/\.eq\('is_partial', false\)/);
  });
});
