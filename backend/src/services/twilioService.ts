/**
 * Twilio Service
 * Handles phone verification, outbound calls, and conference-based recording
 */

import Twilio from 'twilio';
import { twiml as TwiML } from 'twilio';
import { config } from '../config/index.js';

export interface InitiateCallParams {
  from: string; // User's verified phone number
  to: string; // Destination phone number
  userId: string;
  callId: string;
}

export interface CallStatus {
  callSid: string;
  status: string;
  duration?: number;
  errorCode?: string;
  errorMessage?: string;
}

export class TwilioService {
  private static client: Twilio.Twilio | null = null;

  /**
   * Get the Twilio client (singleton)
   */
  private static getClient(): Twilio.Twilio {
    if (!this.client) {
      const accountSid = config.TWILIO_ACCOUNT_SID;
      const authToken = config.TWILIO_AUTH_TOKEN;

      if (!accountSid || !authToken) {
        throw new Error('Twilio credentials not configured');
      }

      this.client = new Twilio.Twilio(accountSid, authToken);
    }
    return this.client;
  }

  /**
   * Check if Twilio is configured
   */
  static isConfigured(): boolean {
    return !!(
      config.TWILIO_ACCOUNT_SID &&
      config.TWILIO_AUTH_TOKEN &&
      config.TWILIO_PHONE_NUMBER
    );
  }

  /**
   * Check if Twilio VoIP is properly configured
   */
  static isVoipConfigured(): boolean {
    return !!(
      this.isConfigured() &&
      config.TWILIO_API_KEY_SID &&
      config.TWILIO_API_KEY_SECRET &&
      config.TWILIO_TWIML_APP_SID
    );
  }

  /**
   * Send verification code via phone call
   * Calls the user and reads them the verification code
   */
  static async sendVerificationCall(
    phoneNumber: string,
    code: string
  ): Promise<string> {
    const client = this.getClient();
    const webhookBaseUrl = config.SERVICE_URL;

    if (!webhookBaseUrl) {
      throw new Error('SERVICE_URL not configured');
    }

    // Create an outbound call that will read the verification code
    const call = await client.calls.create({
      to: phoneNumber,
      from: config.TWILIO_PHONE_NUMBER!,
      url: `${webhookBaseUrl}/v1/webhooks/twilio/verification-voice?code=${code}`,
      statusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/verification-status?phone=${encodeURIComponent(phoneNumber)}`,
      statusCallbackEvent: ['completed', 'failed', 'busy', 'no-answer'],
      statusCallbackMethod: 'POST',
      timeout: 30, // Ring for 30 seconds max
    });

    return call.sid;
  }

  /**
   * Build TwiML for verification call - reads the code to the user
   */
  static buildVerificationTwiml(code: string): string {
    const response = new TwiML.VoiceResponse();

    // Split code into individual digits for clearer pronunciation
    const digits = code.split('').join('. ');

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Hello! This is Meeting Mind calling with your verification code.'
    );

    response.pause({ length: 1 });

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `Your verification code is: ${digits}.`
    );

    response.pause({ length: 1 });

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      `I repeat, your code is: ${digits}.`
    );

    response.pause({ length: 1 });

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Enter this code in the app to verify your phone number. Goodbye!'
    );

    return response.toString();
  }

  /**
   * Generate a 6-digit verification code
   */
  private static generateVerificationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Initiate an outbound call (server-initiated, for clients without VoIP SDK)
   *
   * Flow:
   * 1. Call the USER's verified phone first
   * 2. When user answers, bridge to the RECIPIENT with recording
   * 3. This allows the user to hear and speak on the call
   */
  static async initiateCall(params: InitiateCallParams): Promise<string> {
    const client = this.getClient();
    const webhookBaseUrl = config.SERVICE_URL;

    if (!webhookBaseUrl) {
      throw new Error('SERVICE_URL not configured');
    }

    // Call the USER first (their verified phone number)
    // When they answer, we'll bridge them to the recipient via the caller-connect webhook
    const call = await client.calls.create({
      to: params.from, // Call the USER's verified phone first
      from: config.TWILIO_PHONE_NUMBER!, // Use Twilio number (required by Twilio for outbound)
      url: `${webhookBaseUrl}/v1/webhooks/twilio/caller-connect?call_id=${params.callId}&to=${encodeURIComponent(params.to)}`,
      statusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/call-status?call_id=${params.callId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      timeout: 30, // 30 second timeout
    });

    return call.sid;
  }

  /**
   * Build TwiML for when the caller answers the callback
   * Bridges them to the recipient with recording enabled
   */
  static buildCallerConnectTwiml(toNumber: string, callId: string): string {
    const webhookBaseUrl = config.SERVICE_URL;
    const response = new TwiML.VoiceResponse();

    // Tell the caller we're connecting
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Connecting your call. Recording will begin when the other party answers.'
    );

    // Dial the recipient with recording enabled
    const dial = response.dial({
      callerId: config.TWILIO_PHONE_NUMBER,
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
      timeout: 30,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete?call_id=${callId}`,
      recordingStatusCallbackEvent: ['completed'],
    });

    // When recipient answers, they hear the recording warning before being connected
    dial.number(
      {
        url: `${webhookBaseUrl}/v1/webhooks/twilio/recipient-whisper?call_id=${callId}`,
        method: 'POST',
      },
      toNumber
    );

    return response.toString();
  }

  /**
   * Generate an access token for Twilio Voice SDK (VoIP)
   */
  static generateVoiceAccessToken(identity: string): string {
    const AccessToken = Twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const accessToken = new AccessToken(
      config.TWILIO_ACCOUNT_SID!,
      config.TWILIO_API_KEY_SID!,
      config.TWILIO_API_KEY_SECRET!,
      { identity }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: config.TWILIO_TWIML_APP_SID,
      incomingAllow: false, // We don't receive incoming calls
    });

    accessToken.addGrant(voiceGrant);
    return accessToken.toJwt();
  }

  /**
   * Start recording by creating a conference and adding both parties
   */
  static async startRecording(
    callSid: string,
    callId: string
  ): Promise<{ conferenceName: string }> {
    const client = this.getClient();
    const webhookBaseUrl = config.SERVICE_URL;

    if (!webhookBaseUrl) {
      throw new Error('SERVICE_URL not configured');
    }

    // Generate unique conference name
    const conferenceName = `phone-call-${callId}`;

    // Update the existing call to join the conference
    await client.calls(callSid).update({
      twiml: this.buildConferenceTwiml(conferenceName, true), // record=true
    });

    return { conferenceName };
  }

  /**
   * Stop recording by ending the conference recording
   */
  static async stopRecording(conferenceSid: string): Promise<void> {
    const client = this.getClient();

    // Get active recordings on the conference and stop them
    const recordings = await client.conferences(conferenceSid).recordings.list();

    for (const recording of recordings) {
      if (recording.status === 'in-progress') {
        await client
          .conferences(conferenceSid)
          .recordings(recording.sid)
          .update({ status: 'stopped' });
      }
    }
  }

  /**
   * End a call
   */
  static async endCall(callSid: string): Promise<void> {
    const client = this.getClient();

    try {
      await client.calls(callSid).update({ status: 'completed' });
    } catch (error: any) {
      // Call may already be ended
      if (!error.message?.includes('not found')) {
        throw error;
      }
    }
  }

  /**
   * Get call details
   */
  static async getCall(callSid: string): Promise<CallStatus> {
    const client = this.getClient();
    const call = await client.calls(callSid).fetch();

    return {
      callSid: call.sid,
      status: call.status,
      duration: call.duration ? parseInt(call.duration) : undefined,
    };
  }

  /**
   * Download recording from Twilio
   */
  static async downloadRecording(
    recordingSid: string
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const client = this.getClient();
    const recording = await client.recordings(recordingSid).fetch();

    // Get the media URL (add .mp3 for mp3 format)
    const mediaUrl = `https://api.twilio.com${recording.uri.replace('.json', '.mp3')}`;

    // Download with authentication
    const response = await fetch(mediaUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`
        ).toString('base64')}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download recording: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'audio/mpeg';

    return { buffer, contentType };
  }

  /**
   * Delete recording from Twilio (after we've stored it)
   */
  static async deleteRecording(recordingSid: string): Promise<void> {
    const client = this.getClient();
    await client.recordings(recordingSid).remove();
  }

  /**
   * Build TwiML to dial a number (used when user answers)
   * @deprecated Use buildAutoRecordDialTwiml for auto-recording calls
   */
  static buildDialTwiml(toNumber: string, callId: string): string {
    const webhookBaseUrl = config.SERVICE_URL;
    const response = new TwiML.VoiceResponse();

    response.say('Connecting your call.');

    const dial = response.dial({
      callerId: config.TWILIO_PHONE_NUMBER,
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
    });
    dial.number(toNumber);

    return response.toString();
  }

  /**
   * Build TwiML for auto-recording calls using conference
   * When caller answers, they join a conference with recording enabled
   * Then we dial the recipient who hears a recording warning before joining
   */
  static buildAutoRecordDialTwiml(toNumber: string, callId: string): string {
    const webhookBaseUrl = config.SERVICE_URL;
    const response = new TwiML.VoiceResponse();

    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Connecting your call. Recording will begin when connected.'
    );

    // Dial the recipient with recording announcement
    const dial = response.dial({
      callerId: config.TWILIO_PHONE_NUMBER,
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
    });

    // When recipient answers, they hear the recording warning via the url webhook
    dial.number(
      {
        url: `${webhookBaseUrl}/v1/webhooks/twilio/recipient-whisper?call_id=${callId}`,
        method: 'POST',
      },
      toNumber
    );

    return response.toString();
  }

  /**
   * Build TwiML for VoIP outbound calls
   * Tells the VoIP caller we're connecting, then dials the recipient
   * Recording is done via the <Dial record="record-from-start"> attribute
   *
   * @param toNumber - The recipient's phone number
   * @param callId - The call record ID
   * @param conferenceName - The conference name for this call
   * @param callerIdNumber - The user's verified phone number to show as caller ID
   */
  static buildVoipOutboundTwiml(
    toNumber: string,
    callId: string,
    conferenceName: string,
    callerIdNumber?: string
  ): string {
    const webhookBaseUrl = config.SERVICE_URL;
    const response = new TwiML.VoiceResponse();

    // Tell the VoIP caller we're connecting
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'Connecting your call. Recording will begin when connected.'
    );

    // Use the user's verified number as caller ID if available, otherwise fall back to Twilio number
    const callerId = callerIdNumber || config.TWILIO_PHONE_NUMBER;

    // Dial the recipient with recording enabled
    // record="record-from-answer-dual" records both legs separately
    const dial = response.dial({
      callerId: callerId,
      action: `${webhookBaseUrl}/v1/webhooks/twilio/dial-complete?call_id=${callId}`,
      timeout: 30,
      record: 'record-from-answer-dual',
      recordingStatusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete?call_id=${callId}`,
      recordingStatusCallbackEvent: ['completed'],
    });

    // When recipient answers, they hear the recording warning before being connected
    dial.number(
      {
        url: `${webhookBaseUrl}/v1/webhooks/twilio/recipient-whisper?call_id=${callId}`,
        method: 'POST',
      },
      toNumber
    );

    return response.toString();
  }

  /**
   * Build TwiML for recipient joining conference with recording warning
   */
  static buildRecipientJoinConferenceTwiml(conferenceName: string, callId: string): string {
    const webhookBaseUrl = config.SERVICE_URL;
    const response = new TwiML.VoiceResponse();

    // Play recording warning to recipient
    response.say(
      { voice: 'Polly.Joanna', language: 'en-US' },
      'This call is being recorded. Please be advised that this conversation may be monitored.'
    );

    response.pause({ length: 1 });

    // Connect to conference with recording enabled
    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        record: 'record-from-start',
        recordingStatusCallback: `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete?call_id=${callId}`,
        recordingStatusCallbackEvent: ['completed'],
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Build TwiML for caller to join conference (after recipient whisper)
   * Called when we need to move caller into the conference
   */
  static buildCallerConferenceTwiml(callId: string): string {
    const response = new TwiML.VoiceResponse();
    const conferenceName = `phone-call-${callId}`;

    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: false, // Conference already started by recipient
        endConferenceOnExit: true,
        beep: 'false' as const,
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Build TwiML to join a conference
   */
  static buildConferenceTwiml(
    conferenceName: string,
    record: boolean = false
  ): string {
    const webhookBaseUrl = config.SERVICE_URL;
    const response = new TwiML.VoiceResponse();

    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: false,
        record: record ? 'record-from-start' : 'do-not-record',
        recordingStatusCallback: record
          ? `${webhookBaseUrl}/v1/webhooks/twilio/recording-complete`
          : undefined,
        recordingStatusCallbackEvent: ['completed'],
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Build TwiML for the recording bot (silent participant)
   */
  static buildRecordingBotTwiml(conferenceName: string): string {
    const response = new TwiML.VoiceResponse();

    const dial = response.dial();
    dial.conference(
      {
        startConferenceOnEnter: false, // Don't affect conference state
        endConferenceOnExit: false,
        muted: true, // Bot is silent
        beep: 'false' as const, // No beep when joining
      },
      conferenceName
    );

    return response.toString();
  }

  /**
   * Validate Twilio webhook signature
   */
  static validateWebhookSignature(
    signature: string,
    url: string,
    params: Record<string, string>
  ): boolean {
    const authToken = config.TWILIO_AUTH_TOKEN;
    if (!authToken) return false;

    return Twilio.validateRequest(authToken, signature, url, params);
  }

  /**
   * Format phone number to E.164 format
   */
  static formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // Ensure it starts with +
    if (!cleaned.startsWith('+')) {
      // Assume US number if no country code
      if (cleaned.length === 10) {
        cleaned = '+1' + cleaned;
      } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
        cleaned = '+' + cleaned;
      } else {
        cleaned = '+' + cleaned;
      }
    }

    return cleaned;
  }

  /**
   * Validate phone number format
   */
  static isValidPhoneNumber(phone: string): boolean {
    const formatted = this.formatPhoneNumber(phone);
    // E.164 format: + followed by 1-15 digits
    return /^\+[1-9]\d{1,14}$/.test(formatted);
  }
}
