/**
 * Which recording-page tabs and free-tier limits apply to the signed-in user.
 *
 * The backend decides (GET /api/subscriptions/status -> `features`, see backend/src/services/freeTier.ts);
 * these helpers only turn those flags into UI decisions. Keep this file free of runtime imports so node can
 * load it directly: it is unit-tested by scripts/featureGates.test.mjs (`npm run test:gates`).
 */

export interface PlanFeatures {
  unlimitedRecordings: boolean;
  aiSummaries: boolean;
  qaChat: boolean;
  meetingBot: boolean;
  phoneRecording: boolean;
  calendarSync: boolean;
  exportPdf: boolean;
}

export type RecordingTab = 'summary' | 'transcript' | 'qa';

/** Recordings a free user could make under the legacy limit (backend FREE_TIER_RECORDING_LIMIT). */
export const LEGACY_FREE_RECORDING_LIMIT = 3;

/**
 * Used when the status request has not returned or failed: recording and summaries are free for everyone,
 * the rest is paid. (While loading, the UI shows a skeleton or no lock badge instead of using these.)
 */
export const FREE_TIER_DEFAULT_FEATURES: PlanFeatures = {
  unlimitedRecordings: true,
  aiSummaries: true,
  qaChat: false,
  meetingBot: false,
  phoneRecording: false,
  calendarSync: false,
  exportPdf: true,
};

/** True when the tab should show the "Pro" lock badge. Never locked while the status is loading. */
export function isTabLocked(tab: RecordingTab, features: PlanFeatures, isLoading = false): boolean {
  if (isLoading) return false;
  if (tab === 'summary') return !features.aiSummaries;
  if (tab === 'qa') return !features.qaChat;
  return false;
}

/** True when the "N/3 free used" counter and the new-recording paywall apply (legacy limit mode only). */
export function hasRecordingLimit(features: PlanFeatures, isLoading = false): boolean {
  return !isLoading && !features.unlimitedRecordings;
}
