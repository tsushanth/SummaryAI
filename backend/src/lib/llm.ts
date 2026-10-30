/**
 * Claude API spend accounting for the whole backend (llmUsage.js is copied from the app-failure-reporter repo).
 *
 * One shared instance. Inert until LLM_USAGE_KEY (or FAILURE_REPORTER_KEY) is set: no timers, no network. It records counts and
 * dollars per day / model / feature label only: never prompts, answers, meeting titles or user ids. Reporting never throws into a request.
 * The existing llm_provider / llm_model / token columns in the database are unrelated and untouched.
 */
import { createLlmUsage } from './llmUsage.js';
import { reportProviderFailure } from './alerts.js';

export const llm = createLlmUsage({
  app: 'meetingmind',
  log: (m: string) => console.warn(`[llm-usage] ${m}`),
});

/** Wraps a client's messages.create / messages.stream. Idempotent. Call it on every `new Anthropic(...)`. */
export function instrumentAnthropic<T>(client: T): T {
  llm.instrument(client);
  watchProviderErrors(client);
  return client;
}

/**
 * Every Anthropic call goes through instrumentAnthropic, so this is the one place that sees a dead key, exhausted credit, a
 * 429 or a timeout for ALL features (summaries, Q&A, coaching, intelligence). Side-effect only: the SDK's promise is returned
 * untouched, so callers see exactly the same result and error as before.
 */
function watchProviderErrors(client: unknown): void {
  const messages = (client as { messages?: Record<string, unknown> } | null)?.messages;
  if (!messages || (messages as { __providerWatch?: boolean }).__providerWatch) return;
  const wrap = (name: 'create' | 'stream') => {
    const orig = messages[name];
    if (typeof orig !== 'function') return;
    messages[name] = function (this: unknown, ...args: unknown[]) {
      let out: unknown;
      try {
        out = (orig as (...a: unknown[]) => unknown).apply(messages, args);
      } catch (e) {
        reportProviderFailure('anthropic', e);
        throw e;
      }
      const p = out as { then?: (a: undefined, b: (e: unknown) => void) => unknown } | null;
      if (p && typeof p.then === 'function') p.then(undefined, (e) => { reportProviderFailure('anthropic', e); });
      return out;
    };
  };
  wrap('create');
  wrap('stream');
  try { Object.defineProperty(messages, '__providerWatch', { value: true, enumerable: false }); } catch { /* frozen: skip */ }
}

/** Runs fn with a feature label (low cardinality: a feature name, never content). */
export function withFeature<T>(name: string, fn: () => T): T {
  return llm.withFeature(name, fn);
}

/** Sends pending rows, giving up after maxMs so a slow Worker can never hold up shutdown. */
export async function flushLlmUsage(maxMs = 2500): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      llm.flush(),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, maxMs); }),
    ]);
  } catch {
    // reporting is best effort
  } finally {
    if (timer) clearTimeout(timer);
  }
}
