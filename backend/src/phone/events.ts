/**
 * Every step of the phone feature, written to the existing events table (activation_events, name 'phone_step').
 * Props hold the step, short codes and counts only: never a number, a name, a code or text typed by a person.
 * Test accounts and test devices are marked (props.test) and left out of the funnel (phone_funnel in migration 032).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeProps } from '../services/activationEvents.js';

export const PHONE_STEPS = [
  // reported by the app (allow-list for POST /api/phone/events)
  'tab_opened', 'number_requested', 'consent_shown', 'consent_declined', 'purchase_started',
  'own_number_opened', 'own_number_confirm_shown', 'own_number_confirm_declined', 'agent_form_opened', 'call_result_opened',
  // written by the server
  'verify_started', 'verify_ok', 'verify_failed', 'number_removed', 'business_answer',
  'call_started', 'call_refused', 'call_connected', 'call_ended', 'call_recorded', 'call_discarded',
  'call_transcribed', 'call_transcribe_failed', 'cap_hit', 'purchase_completed', 'agent_created',
  'purchase_failed', 'trial_started', 'trial_refused', 'trial_ended', 'own_number_added', 'own_number_failed', 'own_number_released',
  'agent_updated', 'agent_removed', 'agent_failed', 'agent_result',
] as const;
export type PhoneStep = (typeof PHONE_STEPS)[number];
export const CLIENT_STEPS: readonly PhoneStep[] = [
  'tab_opened', 'number_requested', 'consent_shown', 'consent_declined', 'purchase_started',
  'own_number_opened', 'own_number_confirm_shown', 'own_number_confirm_declined', 'agent_form_opened', 'call_result_opened',
];

export type PhoneProps = Record<string, string | number | boolean | undefined | null>;

export type TrackFn = (step: PhoneStep, userId: string, props?: PhoneProps) => Promise<void>;

const SERVER_ANON_ID = 'server-phone-events';

export function createPhoneTracker(deps: {
  db: SupabaseClient<any, any, any>;
  isTestAccount: (userId: string) => Promise<boolean>;
  onError: () => void;
}): TrackFn {
  return async (step, userId, props = {}) => {
    try {
      const test = props.test === true || (await deps.isTestAccount(userId));
      // 'step' and 'test' go first so the 8-key limit can never drop them.
      const { step: _s, test: _t, ...rest } = props;
      const { error } = await deps.db.from('activation_events').insert({
        anon_id: SERVER_ANON_ID,
        user_id: userId,
        name: 'phone_step',
        platform: 'server',
        props: sanitizeProps({ step, ...(test ? { test: true } : {}), ...rest }),
      });
      if (error) deps.onError();
    } catch {
      deps.onError(); // measuring must never fail a request
    }
  };
}
