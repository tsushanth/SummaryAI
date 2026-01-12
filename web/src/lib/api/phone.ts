/**
 * Phone API functions
 */

import { apiClient } from './client';
import type {
  ListVerifiedPhonesResponse,
  ListPhoneCallsResponse,
  CheckVerificationResponse,
  InitiateCallResponse,
  StartRecordingResponse,
  PhoneCallResponse,
} from '@/types/api';

// ============================================================================
// Phone Verification
// ============================================================================

/**
 * Send verification code to phone number
 */
export async function sendVerificationCode(phoneNumber: string): Promise<void> {
  await apiClient('/api/phone/verify/send', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber }),
  });
}

/**
 * Check verification code
 */
export async function checkVerificationCode(
  phoneNumber: string,
  code: string
): Promise<CheckVerificationResponse> {
  return apiClient('/api/phone/verify/check', {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber, code }),
  });
}

/**
 * Get list of verified phone numbers
 */
export async function getVerifiedPhones(): Promise<ListVerifiedPhonesResponse> {
  return apiClient('/api/phone/verified');
}

/**
 * Delete a verified phone number
 */
export async function deleteVerifiedPhone(id: string): Promise<void> {
  await apiClient(`/api/phone/verified/${id}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Phone Calls
// ============================================================================

/**
 * Initiate a phone call
 */
export async function initiateCall(
  from: string,
  to: string,
  toName?: string
): Promise<InitiateCallResponse> {
  return apiClient('/api/phone/calls', {
    method: 'POST',
    body: JSON.stringify({ from, to, to_name: toName }),
  });
}

/**
 * Get list of phone calls
 */
export async function getPhoneCalls(
  limit: number = 50,
  offset: number = 0
): Promise<ListPhoneCallsResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });
  return apiClient(`/api/phone/calls?${params}`);
}

/**
 * Get phone call details
 */
export async function getPhoneCall(id: string): Promise<PhoneCallResponse> {
  return apiClient(`/api/phone/calls/${id}`);
}

/**
 * Start recording a call
 */
export async function startRecording(callId: string): Promise<StartRecordingResponse> {
  return apiClient(`/api/phone/calls/${callId}/record`, {
    method: 'POST',
  });
}

/**
 * Stop recording a call
 */
export async function stopRecording(callId: string): Promise<void> {
  await apiClient(`/api/phone/calls/${callId}/record`, {
    method: 'DELETE',
  });
}

/**
 * Hang up a call
 */
export async function hangupCall(callId: string): Promise<void> {
  await apiClient(`/api/phone/calls/${callId}/hangup`, {
    method: 'POST',
  });
}
