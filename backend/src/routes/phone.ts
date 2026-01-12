/**
 * Phone Routes
 * Handles phone verification and call management
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { TwilioService } from '../services/twilioService.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ============================================================================
// Schemas
// ============================================================================

const phoneNumberSchema = z.object({
  phone_number: z.string().min(10).max(20),
});

const verifyCodeSchema = z.object({
  phone_number: z.string().min(10).max(20),
  code: z.string().length(6),
});

const initiateCallSchema = z.object({
  from: z.string().min(10).max(20), // User's verified number
  to: z.string().min(10).max(20), // Destination number
  to_name: z.string().max(100).optional(),
  server_initiated: z.boolean().optional(), // If true, backend places the call (for clients without VoIP SDK)
});

// ============================================================================
// Phone Verification
// ============================================================================

/**
 * Send verification code to phone number
 * POST /api/phone/verify/send
 */
router.post(
  '/verify/send',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const parsed = phoneNumberSchema.safeParse(req.body);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid phone number');
    }

    if (!TwilioService.isConfigured()) {
      throw Errors.internal('Phone service not configured');
    }

    const phoneNumber = TwilioService.formatPhoneNumber(parsed.data.phone_number);

    if (!TwilioService.isValidPhoneNumber(phoneNumber)) {
      throw Errors.badRequest('Invalid phone number format');
    }

    // Check rate limiting (max 10 verifications per day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count } = await supabaseAdmin
      .from('verified_phones')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', today.toISOString());

    if ((count || 0) >= 10) {
      throw Errors.badRequest('Too many verification attempts today');
    }

    // Generate verification code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    console.log(`[Phone Verify Send] Generated code: ${code}, expires: ${expiresAt.toISOString()}`);

    // Check if this phone is already being verified
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('verified_phones')
      .select('id, verified_at')
      .eq('user_id', userId)
      .eq('phone_number', phoneNumber)
      .single();

    console.log(`[Phone Verify Send] Existing record: ${JSON.stringify(existing)}, error: ${JSON.stringify(existingError)}`);

    if (existing?.verified_at) {
      throw Errors.badRequest('This phone number is already verified');
    }

    // Upsert verification record
    if (existing) {
      console.log(`[Phone Verify Send] Updating existing record id: ${existing.id}`);
      const { error: updateError } = await supabaseAdmin
        .from('verified_phones')
        .update({
          verification_code: code,
          verification_expires_at: expiresAt.toISOString(),
        })
        .eq('id', existing.id);

      if (updateError) {
        console.error(`[Phone Verify Send] Update error: ${JSON.stringify(updateError)}`);
        throw Errors.internal('Failed to update verification record');
      }
      console.log(`[Phone Verify Send] Updated record successfully`);
    } else {
      console.log(`[Phone Verify Send] Inserting new record`);
      const { error: insertError } = await supabaseAdmin.from('verified_phones').insert({
        user_id: userId,
        phone_number: phoneNumber,
        verification_code: code,
        verification_expires_at: expiresAt.toISOString(),
      });

      if (insertError) {
        console.error(`[Phone Verify Send] Insert error: ${JSON.stringify(insertError)}`);
        throw Errors.internal('Failed to create verification record');
      }
      console.log(`[Phone Verify Send] Inserted record successfully`);
    }

    // Send verification code via phone call
    try {
      const callSid = await TwilioService.sendVerificationCall(phoneNumber, code);
      console.log(`Verification call initiated: ${callSid} to ${phoneNumber}`);
    } catch (error: any) {
      console.error('Failed to initiate verification call:', error.message);
      throw Errors.internal('Failed to send verification code');
    }

    res.json({ message: 'Verification call initiated - answer your phone!' });
  })
);

/**
 * Check verification code
 * POST /api/phone/verify/check
 */
router.post(
  '/verify/check',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const parsed = verifyCodeSchema.safeParse(req.body);

    if (!parsed.success) {
      throw Errors.badRequest('Invalid request');
    }

    const phoneNumber = TwilioService.formatPhoneNumber(parsed.data.phone_number);
    const code = parsed.data.code;

    console.log(`[Phone Verify] Checking code for phone: ${phoneNumber}, submitted code: ${code}`);

    // Check our stored code (from the verification call)
    const { data: phone, error: fetchError } = await supabaseAdmin
      .from('verified_phones')
      .select('*')
      .eq('user_id', userId)
      .eq('phone_number', phoneNumber)
      .is('verified_at', null)
      .single();

    console.log(`[Phone Verify] DB lookup result - phone: ${JSON.stringify(phone)}, error: ${JSON.stringify(fetchError)}`);

    if (!phone) {
      throw Errors.notFound('Verification not found. Please request a new verification call.');
    }

    console.log(`[Phone Verify] Stored code: ${phone.verification_code}, submitted: ${code}, expires: ${phone.verification_expires_at}`);

    if (new Date(phone.verification_expires_at) < new Date()) {
      throw Errors.badRequest('Verification code expired. Please request a new call.');
    }

    if (phone.verification_code !== code) {
      console.log(`[Phone Verify] Code mismatch! stored='${phone.verification_code}' vs submitted='${code}'`);
      throw Errors.badRequest('Invalid verification code');
    }

    // Mark as verified
    const { data: updatedPhone, error: updateError } = await supabaseAdmin
      .from('verified_phones')
      .update({
        verified_at: new Date().toISOString(),
        verification_code: null, // Clear code
        verification_expires_at: null,
      })
      .eq('id', phone.id) // Use the id from the phone record we already found
      .select()
      .single();

    if (updateError || !updatedPhone) {
      console.error('Failed to update verified phone:', updateError);
      throw Errors.internal('Failed to verify phone number');
    }

    res.json({
      verified: true,
      phone: {
        id: updatedPhone.id,
        phone_number: updatedPhone.phone_number,
        verified_at: updatedPhone.verified_at,
        created_at: updatedPhone.created_at,
      },
    });
  })
);

/**
 * List verified phone numbers
 * GET /api/phone/verified
 */
router.get(
  '/verified',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const { data: phones, error } = await supabaseAdmin
      .from('verified_phones')
      .select('id, phone_number, verified_at, created_at')
      .eq('user_id', userId)
      .not('verified_at', 'is', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ phones: phones || [] });
  })
);

/**
 * Delete verified phone number
 * DELETE /api/phone/verified/:id
 */
router.delete(
  '/verified/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const phoneId = req.params.id;

    const { error } = await supabaseAdmin
      .from('verified_phones')
      .delete()
      .eq('id', phoneId)
      .eq('user_id', userId);

    if (error) throw error;

    res.json({ deleted: true });
  })
);

// ============================================================================
// VoIP Access Token
// ============================================================================

/**
 * Get Twilio access token for VoIP calling
 * GET /api/phone/voip/token
 */
router.get(
  '/voip/token',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    if (!TwilioService.isVoipConfigured()) {
      throw Errors.internal('VoIP service not configured');
    }

    // Use user ID as the identity for the Twilio client
    const token = TwilioService.generateVoiceAccessToken(userId);

    res.json({ token });
  })
);

// ============================================================================
// Phone Calls
// ============================================================================

/**
 * Create a phone call record (for VoIP calls)
 * The actual call is initiated by the Twilio Voice SDK on the client
 * POST /api/phone/calls
 */
router.post(
  '/calls',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    console.log(`[Phone Calls] Create call request body:`, JSON.stringify(req.body));

    const parsed = initiateCallSchema.safeParse(req.body);

    if (!parsed.success) {
      console.log(`[Phone Calls] Validation failed:`, JSON.stringify(parsed.error.errors));
      throw Errors.badRequest('Invalid request');
    }

    if (!TwilioService.isConfigured()) {
      throw Errors.internal('Phone service not configured');
    }

    const fromNumber = TwilioService.formatPhoneNumber(parsed.data.from);
    const toNumber = TwilioService.formatPhoneNumber(parsed.data.to);

    // Verify the "from" number belongs to this user
    const { data: verifiedPhone } = await supabaseAdmin
      .from('verified_phones')
      .select('id')
      .eq('user_id', userId)
      .eq('phone_number', fromNumber)
      .not('verified_at', 'is', null)
      .single();

    if (!verifiedPhone) {
      throw Errors.badRequest('From number is not verified');
    }

    // Generate conference name for auto-recording
    const conferenceName = `phone-call-${Date.now()}`;

    // Create phone call record with auto-recording enabled
    const { data: phoneCall, error: insertError } = await supabaseAdmin
      .from('phone_calls')
      .insert({
        user_id: userId,
        from_number: fromNumber,
        to_number: toNumber,
        to_name: parsed.data.to_name,
        status: 'initiated',
        started_at: new Date().toISOString(),
        is_recording: true, // Auto-recording enabled from start
        conference_name: conferenceName,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    let twilioCallSid: string | null = null;

    // If server_initiated is true, place the call directly via Twilio REST API
    // This is for clients without the Twilio Voice SDK (iOS currently)
    if (parsed.data.server_initiated) {
      try {
        console.log(`[Phone Calls] Server-initiated call requested, placing call to ${toNumber}`);

        // Place the call using Twilio REST API
        twilioCallSid = await TwilioService.initiateCall({
          from: fromNumber,
          to: toNumber,
          userId,
          callId: phoneCall.id,
        });

        // Update call with Twilio SID
        await supabaseAdmin
          .from('phone_calls')
          .update({
            twilio_call_sid: twilioCallSid,
            status: 'ringing',
          })
          .eq('id', phoneCall.id);

        console.log(`[Phone Calls] Server-initiated call placed: ${twilioCallSid}`);
      } catch (error: any) {
        console.error(`[Phone Calls] Failed to place server-initiated call:`, error.message);

        // Update call status to failed
        await supabaseAdmin
          .from('phone_calls')
          .update({ status: 'failed' })
          .eq('id', phoneCall.id);

        throw Errors.internal('Failed to place call: ' + error.message);
      }
    }

    // Return call record
    res.status(201).json({
      call_id: phoneCall.id,
      status: parsed.data.server_initiated ? 'ringing' : 'initiated',
      conference_name: conferenceName,
      to_number: toNumber,
      twilio_call_sid: twilioCallSid,
    });
  })
);

/**
 * List phone calls
 * GET /api/phone/calls
 */
router.get(
  '/calls',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const { data: calls, error, count } = await supabaseAdmin
      .from('phone_calls')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      calls: calls || [],
      total: count || 0,
      limit,
      offset,
    });
  })
);

/**
 * Get phone call details
 * GET /api/phone/calls/:id
 */
router.get(
  '/calls/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const callId = req.params.id;

    const { data: call, error } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();

    if (error || !call) {
      throw Errors.notFound('Call not found');
    }

    res.json({ call });
  })
);

/**
 * Start recording a call
 * POST /api/phone/calls/:id/record
 */
router.post(
  '/calls/:id/record',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const callId = req.params.id;

    const { data: call, error } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();

    if (error || !call) {
      throw Errors.notFound('Call not found');
    }

    if (call.status !== 'in_progress') {
      throw Errors.badRequest('Call is not in progress');
    }

    if (call.is_recording) {
      throw Errors.badRequest('Already recording');
    }

    if (!call.twilio_call_sid) {
      throw Errors.badRequest('Call SID not available');
    }

    try {
      // Start recording via conference
      const { conferenceName } = await TwilioService.startRecording(
        call.twilio_call_sid,
        callId
      );

      // Update call record
      await supabaseAdmin
        .from('phone_calls')
        .update({
          is_recording: true,
          conference_name: conferenceName,
          recording_started_at: new Date().toISOString(),
          status: 'recording',
        })
        .eq('id', callId);

      res.json({
        recording: true,
        conference_name: conferenceName,
      });
    } catch (error: any) {
      console.error('Failed to start recording:', error.message);
      throw Errors.internal('Failed to start recording');
    }
  })
);

/**
 * Stop recording a call
 * DELETE /api/phone/calls/:id/record
 */
router.delete(
  '/calls/:id/record',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const callId = req.params.id;

    const { data: call, error } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();

    if (error || !call) {
      throw Errors.notFound('Call not found');
    }

    if (!call.is_recording) {
      throw Errors.badRequest('Not recording');
    }

    if (call.conference_sid) {
      try {
        await TwilioService.stopRecording(call.conference_sid);
      } catch (error: any) {
        console.error('Failed to stop recording:', error.message);
        // Continue anyway - recording may have already stopped
      }
    }

    // Update call record
    await supabaseAdmin
      .from('phone_calls')
      .update({
        is_recording: false,
        status: 'in_progress',
      })
      .eq('id', callId);

    res.json({ recording: false });
  })
);

/**
 * Hang up a call
 * POST /api/phone/calls/:id/hangup
 */
router.post(
  '/calls/:id/hangup',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const callId = req.params.id;

    const { data: call, error } = await supabaseAdmin
      .from('phone_calls')
      .select('*')
      .eq('id', callId)
      .eq('user_id', userId)
      .single();

    if (error || !call) {
      throw Errors.notFound('Call not found');
    }

    if (call.twilio_call_sid) {
      try {
        await TwilioService.endCall(call.twilio_call_sid);
      } catch (error: any) {
        console.error('Failed to end call:', error.message);
        // Continue anyway - call may have already ended
      }
    }

    // Update call record
    await supabaseAdmin
      .from('phone_calls')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
      })
      .eq('id', callId);

    res.json({ ended: true });
  })
);

export default router;
