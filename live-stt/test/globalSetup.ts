import { ensureFixture } from './harness/fixture.js';

/** Render the 60 s test meeting once before the suite (macOS `say`, or the synthetic fallback). */
export default function setup(): void {
  const fx = ensureFixture();
  console.log(`[fixture] ${fx.durationMs / 1000}s, ${fx.utterances.length} utterances, ${fx.synthetic ? 'synthetic tones' : 'say voices Samantha+Daniel'}`);
}
