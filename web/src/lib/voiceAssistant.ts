// In-meeting voice assistant on/off (backend GET/PUT /api/voice-assistant, docs/VOICE_ASSISTANT.md). Pure helpers so they can be
// unit tested with `npm test` (Node strips the types).

/** Body of GET and PUT /api/voice-assistant: the caller's effective state. */
export interface VoiceAssistantState {
  enabled?: boolean | null;
  /** enabled | user_opted_out | killed | mode_off | not_opted_in */
  reason?: string | null;
  /** The user's own saved choice; null/undefined = never chosen. */
  preference?: boolean | null;
  /** Server rollout mode: off | opt_in | all */
  mode?: string | null;
}

/**
 * What the switch shows. The user's own saved choice wins; if they never chose, it follows the server (rollout mode "all"
 * means on). A server-wide kill is not shown as a user opt-out: with no saved choice the switch just reads off.
 */
export function switchOn(s: VoiceAssistantState | null | undefined): boolean {
  if (!s) return false;
  if (typeof s.preference === 'boolean') return s.preference;
  return s.mode === 'all' || s.enabled === true;
}

/**
 * Optimistic save. `onChange` is called with the new value at once (flip the switch) and, if `save` fails, with the old value
 * again (roll back). Resolves to `{ checked, failed }` with the value the switch must show. Never throws.
 */
export async function saveVoiceAssistant(
  previous: boolean,
  next: boolean,
  save: (enabled: boolean) => Promise<VoiceAssistantState | null | undefined>,
  onChange: (checked: boolean) => void,
): Promise<{ checked: boolean; failed: boolean }> {
  if (previous === next) return { checked: previous, failed: false };
  onChange(next);
  try {
    const stored = await save(next);
    const checked = typeof stored?.preference === 'boolean' ? stored.preference : next;
    if (checked !== next) onChange(checked);
    return { checked, failed: false };
  } catch {
    onChange(previous);
    return { checked: previous, failed: true };
  }
}
