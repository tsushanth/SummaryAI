/** What the phone services need from outside. Production wiring is in index.ts; tests pass fakes. */
import type { PhoneSettings } from './settings.js';
import type { PhoneStore } from './store.js';
import type { TelephonyGateway } from './gateway.js';
import type { TrackFn } from './events.js';
import type { NumbersStore } from './numbersStore.js';
import type { PlayVerifier } from './provision.js';
import type { CalldeskClient } from './calldesk.js';
import type { PhonePlan } from './plan.js';

export interface PhoneDeps {
  settings: PhoneSettings;
  store: PhoneStore;
  gateway: TelephonyGateway;
  track: TrackFn;
  /** Stable alert class, number-free context only. */
  alert: (code: string, context?: Record<string, string | number>) => void;
  /** Starts transcription and summary of a saved recording. */
  process: (recordingId: string, userId: string) => Promise<unknown>;
  /** Whether this account has phone calls right now (feature flag or tester list). */
  hasAccess: (userId: string) => boolean;
  now: () => number;
  newId: () => string;
  later: (ms: number, fn: () => Promise<unknown>) => void;
  /** Numbers, subscriptions and agents. Absent until migration 033 is applied (PHONE_NUMBERS_SCHEMA). */
  extras?: PhoneExtras;
}

export interface PhoneExtras {
  numbers: NumbersStore;
  play: PlayVerifier;
  /** Null when the Calldesk partner settings are absent. */
  calldesk: CalldeskClient | null;
  plan: () => PhonePlan;
}

/** A refusal the app can render: `code` is stable, `message` is English for logs and old clients. */
export class PhoneError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'PhoneError';
  }
}
