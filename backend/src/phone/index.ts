/** Production wiring of the phone feature. Returns null when the calls subaccount is not configured (feature absent). */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { config } from '../config/index.js';
import { reportAlert } from '../lib/alerts.js';
import { expectLoop, registerLoop, runLoopPass } from '../lib/loopMonitor.js';
import { hasPhoneCalls, isPhoneTester } from '../config/featureFlags.js';
import { triggerProcessing } from '../services/processingService.js';
import { TEST_ACCOUNT_RE } from '../services/firstRecordingAlert.js';
import { readPhoneSettings } from './settings.js';
import { createSupabaseStore } from './store.js';
import { createTwilioGateway } from './gateway.js';
import { createPhoneTracker } from './events.js';
import type { PhoneDeps } from './deps.js';
import { PHONE_SWEEP_INTERVAL_MS, sweepPhoneCalls } from './sweeper.js';
import { createSupabaseNumbersStore } from './numbersStore.js';
import { createCalldeskClient, readCalldeskSettings } from './calldesk.js';
import { readAgentTrial, readPhonePlan } from './plan.js';
import { getSubscriptionPurchase, acknowledgeSubscription } from '../services/googlePlayBilling.js';

let cached: { key: string; deps: PhoneDeps } | null = null;

export function getPhoneDeps(): PhoneDeps | null {
  const settings = readPhoneSettings();
  if (!settings) return null;
  const calldeskSettings = readCalldeskSettings();
  const numbersOn = ['1', 'true', 'on', 'yes'].includes(String(process.env.PHONE_NUMBERS_SCHEMA ?? '').trim().toLowerCase());
  const key = JSON.stringify([settings, calldeskSettings, numbersOn]);
  if (cached?.key === key) return cached.deps;
  const store = createSupabaseStore(supabaseAdmin, config.STORAGE_BUCKET_AUDIO);
  const alert: PhoneDeps['alert'] = (code, context) => { reportAlert('phone_calls', code, context ?? {}); };
  const testCache = new Map<string, boolean>();
  const isTestAccount = async (userId: string): Promise<boolean> => {
    if (isPhoneTester(userId)) return true;
    const known = testCache.get(userId);
    if (known !== undefined) return known;
    const info = await store.userInfo(userId);
    const test = TEST_ACCOUNT_RE.test(info?.email ?? '');
    if (testCache.size > 5000) testCache.clear();
    if (info) testCache.set(userId, test);
    return test;
  };
  const deps: PhoneDeps = {
    settings,
    store,
    gateway: createTwilioGateway(settings),
    track: createPhoneTracker({ db: supabaseAdmin, isTestAccount, onError: () => alert('EVENT_WRITE_FAILED') }),
    alert,
    process: (recordingId, userId) => triggerProcessing(recordingId, userId),
    hasAccess: (userId) => hasPhoneCalls(userId),
    now: () => Date.now(),
    newId: () => randomUUID(),
    later: (ms, fn) => { setTimeout(() => { fn().catch(() => alert('DEFERRED_TASK_FAILED')); }, ms).unref?.(); },
    // Numbers, subscriptions and agents need migration 033: switched on with PHONE_NUMBERS_SCHEMA once it is applied.
    extras: numbersOn ? {
      numbers: createSupabaseNumbersStore(supabaseAdmin),
      play: { get: (token) => getSubscriptionPurchase(token), acknowledge: (product, token) => acknowledgeSubscription(product, token) },
      calldesk: calldeskSettings ? createCalldeskClient(calldeskSettings) : null,
      plan: () => readPhonePlan(),
      trialOn: () => readAgentTrial(),
    } : undefined,
  };
  cached = { key, deps };
  return deps;
}

/** Runs whenever the subaccount is configured, also with the feature switched off (calls in flight must finish). */
export function startPhoneSweepLoop(): boolean {
  if (!readPhoneSettings()) return false;
  expectLoop('PhoneCalls');
  registerLoop('PhoneCalls', PHONE_SWEEP_INTERVAL_MS);
  const pass = async () => { const d = getPhoneDeps(); if (d) await sweepPhoneCalls(d); };
  setTimeout(() => void runLoopPass('PhoneCalls', pass), 30_000);
  setInterval(() => void runLoopPass('PhoneCalls', pass), PHONE_SWEEP_INTERVAL_MS).unref?.();
  console.log('[PhoneCalls] sweep loop started');
  return true;
}
