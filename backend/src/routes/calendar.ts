/**
 * Calendar Routes
 * Google Calendar OAuth and sync endpoints
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../lib/supabase.js';
import { encryptToken, decryptToken } from '../services/encryptionService.js';
import {
  GoogleCalendarService,
  extractMeetingUrl,
  detectPlatformFromUrl,
  generateOAuthState,
  parseOAuthState,
} from '../services/googleCalendarService.js';
import {
  MicrosoftCalendarService,
  extractMicrosoftMeetingUrl,
  detectMicrosoftPlatformFromUrl,
} from '../services/microsoftCalendarService.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler, Errors } from '../middleware/errorHandler.js';
import {
  CalendarConnection,
  CalendarConnectionResponse,
  CalendarConnectResponse,
  CalendarSyncResponse,
} from '../types/meetings.js';

const router = Router();

// Separate router for OAuth callback (no auth required - browser redirect from Google)
export const calendarCallbackRouter = Router();

// OAuth state expiry in milliseconds (5 minutes)
const OAUTH_STATE_EXPIRY = 5 * 60 * 1000;

/**
 * Generate HTML page that closes the popup and notifies parent window
 * Used for web OAuth flow (popup window)
 */
function generateOAuthSuccessPage(provider: string, email: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Calendar Connected</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f9fafb;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1rem;
    }
    .success-icon svg {
      width: 32px;
      height: 32px;
      color: white;
    }
    h1 {
      color: #111827;
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    p {
      color: #6b7280;
      margin-bottom: 1rem;
    }
    .email {
      font-weight: 500;
      color: #374151;
    }
    .close-btn {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
      text-decoration: none;
    }
    .close-btn:hover {
      background: #2563eb;
    }
    .status {
      font-size: 0.875rem;
      color: #9ca3af;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
    </div>
    <h1>Calendar Connected!</h1>
    <p>Successfully connected <span class="email">${email}</span></p>
    <p class="status" id="status">Closing window...</p>
    <button class="close-btn" id="closeBtn" style="display: none;" onclick="handleClose()">Close Window</button>
  </div>
  <script>
    function handleClose() {
      // Try to close the window
      window.close();
      // If still here after 100ms, redirect to app
      setTimeout(() => {
        window.location.href = 'https://meetingmind.org/meetings';
      }, 100);
    }

    // Try to notify parent and close
    function tryClose() {
      // Try postMessage to parent (works if same origin or opener exists)
      if (window.opener) {
        try {
          window.opener.postMessage({
            type: 'calendar-connected',
            provider: '${provider}',
            email: '${email}'
          }, '*');
        } catch (e) {}
      }

      // Try to close the window
      window.close();

      // If window didn't close after 500ms, show manual close button
      setTimeout(() => {
        if (!window.closed) {
          document.getElementById('status').textContent = 'You can now close this window';
          document.getElementById('closeBtn').style.display = 'inline-block';
        }
      }, 500);
    }

    // Execute on load
    tryClose();
  </script>
</body>
</html>
`;
}

/**
 * Generate HTML page for OAuth errors (web flow)
 */
function generateOAuthErrorPage(message: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>Connection Failed</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f9fafb;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .error-icon {
      width: 64px;
      height: 64px;
      background: #ef4444;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1rem;
    }
    .error-icon svg {
      width: 32px;
      height: 32px;
      color: white;
    }
    h1 {
      color: #111827;
      font-size: 1.5rem;
      margin-bottom: 0.5rem;
    }
    p {
      color: #6b7280;
      margin-bottom: 1rem;
    }
    .error-msg {
      background: #fef2f2;
      color: #b91c1c;
      padding: 0.5rem 1rem;
      border-radius: 0.375rem;
      font-size: 0.875rem;
    }
    .close-btn {
      display: inline-block;
      margin-top: 1rem;
      padding: 0.75rem 1.5rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 0.5rem;
      font-size: 1rem;
      cursor: pointer;
      text-decoration: none;
    }
    .close-btn:hover {
      background: #2563eb;
    }
    .status {
      font-size: 0.875rem;
      color: #9ca3af;
      margin-top: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    </div>
    <h1>Connection Failed</h1>
    <p class="error-msg">${message}</p>
    <p class="status" id="status">Closing window...</p>
    <button class="close-btn" id="closeBtn" style="display: none;" onclick="handleClose()">Close Window</button>
  </div>
  <script>
    function handleClose() {
      window.close();
      setTimeout(() => {
        window.location.href = 'https://meetingmind.org/meetings';
      }, 100);
    }

    function tryClose() {
      if (window.opener) {
        try {
          window.opener.postMessage({
            type: 'calendar-error',
            error: '${message}'
          }, '*');
        } catch (e) {}
      }

      window.close();

      setTimeout(() => {
        if (!window.closed) {
          document.getElementById('status').textContent = 'You can now close this window';
          document.getElementById('closeBtn').style.display = 'inline-block';
        }
      }, 500);
    }

    tryClose();
  </script>
</body>
</html>
`;
}

/**
 * Check if request is from web (vs mobile app)
 * Web requests come from popup windows opened by the web app
 * iOS/mobile requests should get deep link redirects (summaryai://)
 */
function isWebRequest(req: Request): boolean {
  const userAgent = req.headers['user-agent'] || '';

  // Check for mobile devices - these should get deep link redirects
  const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(userAgent);
  if (isMobileDevice) {
    return false;
  }

  // Desktop browsers get the HTML popup flow
  const isDesktopBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/.test(userAgent) &&
                          !/SummaryAI|MeetingMind/.test(userAgent);
  return isDesktopBrowser;
}

// All authenticated routes
router.use(authenticate);

/**
 * POST /api/calendar/connect/google
 * Initiate Google OAuth flow
 */
router.post(
  '/connect/google',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    // Generate state token for CSRF protection
    const nonce = crypto.randomUUID();
    const state = generateOAuthState(userId, nonce);

    // Store state temporarily for validation
    const expiresAt = new Date(Date.now() + OAUTH_STATE_EXPIRY).toISOString();

    await supabaseAdmin.from('oauth_states').insert({
      state,
      user_id: userId,
      provider: 'google',
      expires_at: expiresAt,
    });

    // Generate auth URL
    const authUrl = GoogleCalendarService.getAuthUrl(state);

    const response: CalendarConnectResponse = { auth_url: authUrl };
    res.json(response);
  })
);

/**
 * POST /api/calendar/connect/microsoft
 * Initiate Microsoft OAuth flow for Outlook/Teams calendar
 */
router.post(
  '/connect/microsoft',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    // Generate state token for CSRF protection
    const nonce = crypto.randomUUID();
    const state = generateOAuthState(userId, nonce);

    // Store state temporarily for validation
    const expiresAt = new Date(Date.now() + OAUTH_STATE_EXPIRY).toISOString();

    await supabaseAdmin.from('oauth_states').insert({
      state,
      user_id: userId,
      provider: 'microsoft',
      expires_at: expiresAt,
    });

    // Generate auth URL
    const authUrl = MicrosoftCalendarService.getAuthUrl(state);

    const response: CalendarConnectResponse = { auth_url: authUrl };
    res.json(response);
  })
);

/**
 * GET /api/calendar/callback/google
 * Handle Google OAuth callback (PUBLIC - no auth required)
 * This is a browser redirect from Google OAuth, not an API call
 */
calendarCallbackRouter.get('/callback/google', async (req: Request, res: Response) => {
  const { code, state, error: oauthError } = req.query;
  const isWeb = isWebRequest(req);

  // Helper to send response based on platform
  const sendError = (message: string) => {
    if (isWeb) {
      res.send(generateOAuthErrorPage(message));
    } else {
      res.redirect(`summaryai://calendar/error?message=${encodeURIComponent(message)}`);
    }
  };

  const sendSuccess = (provider: string, email: string) => {
    if (isWeb) {
      res.send(generateOAuthSuccessPage(provider, email));
    } else {
      res.redirect(`summaryai://calendar/connected?provider=${provider}&email=${encodeURIComponent(email)}`);
    }
  };

  // OAuth error handling
  if (oauthError) {
    console.error('[Calendar] OAuth error:', oauthError);
    sendError(String(oauthError));
    return;
  }

  if (!code || !state) {
    sendError('missing_params');
    return;
  }

  try {
    // Parse and validate state
    const stateData = parseOAuthState(state as string);
    if (!stateData) {
      sendError('invalid_state');
      return;
    }

    // Verify state exists in database and hasn't expired
    const { data: storedState, error: stateError } = await supabaseAdmin
      .from('oauth_states')
      .select('*')
      .eq('state', state)
      .single();

    if (stateError || !storedState) {
      console.error('[Calendar] State not found or expired');
      sendError('invalid_state');
      return;
    }

    // Check expiry
    if (new Date(storedState.expires_at) < new Date()) {
      await supabaseAdmin.from('oauth_states').delete().eq('state', state);
      sendError('state_expired');
      return;
    }

    const userId = storedState.user_id;

    // Delete used state
    await supabaseAdmin.from('oauth_states').delete().eq('state', state);

    // Exchange code for tokens
    const tokens = await GoogleCalendarService.exchangeCode(code as string);

    // Get user info from Google
    const userInfo = await GoogleCalendarService.getUserInfo(tokens.access_token);

    // Encrypt tokens before storage
    const encryptedAccessToken = encryptToken(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : null;

    const tokenExpiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    // Upsert calendar connection
    const { error: upsertError } = await supabaseAdmin
      .from('calendar_connections')
      .upsert(
        {
          user_id: userId,
          provider: 'google',
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
          provider_account_id: userInfo.id,
          provider_email: userInfo.email,
          sync_enabled: true,
        },
        {
          onConflict: 'user_id,provider',
        }
      );

    if (upsertError) {
      console.error('[Calendar] Failed to save connection:', upsertError);
      sendError('save_failed');
      return;
    }

    console.log(`[Calendar] Connected Google Calendar for user ${userId}`);

    // Trigger initial sync in background (don't wait for it)
    const connection: CalendarConnection = {
      id: '', // Will be fetched
      user_id: userId,
      provider: 'google',
      provider_account_id: userInfo.id,
      provider_email: userInfo.email,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      token_expires_at: tokenExpiresAt,
      sync_enabled: true,
      sync_token: null,
      last_synced_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Initial sync - run in background
    syncCalendarConnection(connection).then(result => {
      console.log(`[Calendar] Initial sync complete for ${userInfo.email}: ${result.created} meetings created`);
    }).catch(err => {
      console.error(`[Calendar] Initial sync failed for ${userInfo.email}:`, err);
    });

    // Send success response
    sendSuccess('google', userInfo.email);
  } catch (error) {
    console.error('[Calendar] OAuth callback error:', error);
    sendError('callback_failed');
  }
});

/**
 * GET /api/calendar/callback/microsoft
 * Handle Microsoft OAuth callback (PUBLIC - no auth required)
 * This is a browser redirect from Microsoft OAuth, not an API call
 */
calendarCallbackRouter.get('/callback/microsoft', async (req: Request, res: Response) => {
  const { code, state, error: oauthError, error_description } = req.query;
  const isWeb = isWebRequest(req);

  // Helper to send response based on platform
  const sendError = (message: string) => {
    if (isWeb) {
      res.send(generateOAuthErrorPage(message));
    } else {
      res.redirect(`summaryai://calendar/error?message=${encodeURIComponent(message)}`);
    }
  };

  const sendSuccess = (provider: string, email: string) => {
    if (isWeb) {
      res.send(generateOAuthSuccessPage(provider, email));
    } else {
      res.redirect(`summaryai://calendar/connected?provider=${provider}&email=${encodeURIComponent(email)}`);
    }
  };

  // OAuth error handling
  if (oauthError) {
    console.error('[Calendar] Microsoft OAuth error:', oauthError, error_description);
    sendError(String(oauthError));
    return;
  }

  if (!code || !state) {
    sendError('missing_params');
    return;
  }

  try {
    // Parse and validate state
    const stateData = parseOAuthState(state as string);
    if (!stateData) {
      sendError('invalid_state');
      return;
    }

    // Verify state exists in database and hasn't expired
    const { data: storedState, error: stateError } = await supabaseAdmin
      .from('oauth_states')
      .select('*')
      .eq('state', state)
      .single();

    if (stateError || !storedState) {
      console.error('[Calendar] Microsoft state not found or expired');
      sendError('invalid_state');
      return;
    }

    // Check expiry
    if (new Date(storedState.expires_at) < new Date()) {
      await supabaseAdmin.from('oauth_states').delete().eq('state', state);
      sendError('state_expired');
      return;
    }

    const userId = storedState.user_id;

    // Delete used state
    await supabaseAdmin.from('oauth_states').delete().eq('state', state);

    // Exchange code for tokens
    const tokens = await MicrosoftCalendarService.exchangeCode(code as string);

    // Get user info from Microsoft Graph
    const userInfo = await MicrosoftCalendarService.getUserInfo(tokens.access_token);

    // Get email (Microsoft can return it in different fields)
    const userEmail = userInfo.mail || userInfo.userPrincipalName;

    // Encrypt tokens before storage
    const encryptedAccessToken = encryptToken(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encryptToken(tokens.refresh_token)
      : null;

    const tokenExpiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    // Upsert calendar connection
    const { error: upsertError } = await supabaseAdmin
      .from('calendar_connections')
      .upsert(
        {
          user_id: userId,
          provider: 'microsoft',
          access_token: encryptedAccessToken,
          refresh_token: encryptedRefreshToken,
          token_expires_at: tokenExpiresAt,
          provider_account_id: userInfo.id,
          provider_email: userEmail,
          sync_enabled: true,
        },
        {
          onConflict: 'user_id,provider',
        }
      );

    if (upsertError) {
      console.error('[Calendar] Failed to save Microsoft connection:', upsertError);
      sendError('save_failed');
      return;
    }

    console.log(`[Calendar] Connected Microsoft Calendar for user ${userId}`);

    // Trigger initial sync in background (don't wait for it)
    const connection: CalendarConnection = {
      id: '', // Will be fetched
      user_id: userId,
      provider: 'microsoft',
      provider_account_id: userInfo.id,
      provider_email: userEmail,
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      token_expires_at: tokenExpiresAt,
      sync_enabled: true,
      sync_token: null,
      last_synced_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Initial sync - run in background
    syncMicrosoftCalendarConnection(connection).then(result => {
      console.log(`[Calendar] Initial Microsoft sync complete for ${userEmail}: ${result.created} meetings created`);
    }).catch(err => {
      console.error(`[Calendar] Initial Microsoft sync failed for ${userEmail}:`, err);
    });

    // Send success response
    sendSuccess('microsoft', userEmail);
  } catch (error) {
    console.error('[Calendar] Microsoft OAuth callback error:', error);
    sendError('callback_failed');
  }
});

/**
 * GET /api/calendar/connections
 * List connected calendars for the user
 */
router.get(
  '/connections',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const { data, error } = await supabaseAdmin
      .from('calendar_connections')
      .select('id, provider, provider_email, sync_enabled, last_synced_at, created_at')
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    const connections: CalendarConnectionResponse[] = (data || []).map((c) => ({
      id: c.id,
      provider: c.provider,
      provider_email: c.provider_email,
      sync_enabled: c.sync_enabled,
      last_synced_at: c.last_synced_at,
      created_at: c.created_at,
    }));

    res.json({ connections });
  })
);

/**
 * DELETE /api/calendar/connections/:provider
 * Disconnect a calendar provider
 */
router.delete(
  '/connections/:provider',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const provider = req.params.provider;

    if (provider !== 'google' && provider !== 'microsoft') {
      throw Errors.badRequest('Invalid provider');
    }

    // Get connection to revoke tokens
    const { data: connection } = await supabaseAdmin
      .from('calendar_connections')
      .select('access_token, refresh_token')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    if (connection) {
      // Revoke tokens if possible
      try {
        const accessToken = decryptToken(connection.access_token);
        if (provider === 'google') {
          await GoogleCalendarService.revokeToken(accessToken);
        } else if (provider === 'microsoft') {
          await MicrosoftCalendarService.revokeToken(accessToken);
        }
      } catch {
        // Token revocation is best-effort
      }
    }

    // First, get the connection ID to delete associated meetings
    const { data: connToDelete } = await supabaseAdmin
      .from('calendar_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    if (connToDelete) {
      // Delete all meetings that came from this calendar connection
      // This ensures user data is properly removed when they disconnect
      const { error: meetingsError, count } = await supabaseAdmin
        .from('meetings')
        .delete({ count: 'exact' })
        .eq('calendar_connection_id', connToDelete.id);

      if (meetingsError) {
        console.error(`[Calendar] Failed to delete meetings for connection ${connToDelete.id}:`, meetingsError);
      } else {
        console.log(`[Calendar] Deleted ${count} meetings from ${provider} calendar for user ${userId}`);
      }
    }

    // Delete connection
    const { error } = await supabaseAdmin
      .from('calendar_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    if (error) {
      throw error;
    }

    console.log(`[Calendar] Disconnected ${provider} for user ${userId}`);

    res.json({ ok: true });
  })
);

/**
 * POST /api/calendar/sync
 * Trigger calendar sync for all connected calendars
 */
router.post(
  '/sync',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    // Get all enabled connections
    const { data: connections, error: connError } = await supabaseAdmin
      .from('calendar_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('sync_enabled', true);

    if (connError) {
      throw connError;
    }

    if (!connections || connections.length === 0) {
      res.json({ synced: 0, meetings_created: 0, meetings_updated: 0 });
      return;
    }

    let syncedCount = 0;
    let meetingsCreated = 0;
    let meetingsUpdated = 0;

    for (const connection of connections) {
      try {
        const result = await syncCalendarConnection(connection as CalendarConnection);
        syncedCount++;
        meetingsCreated += result.created;
        meetingsUpdated += result.updated;
      } catch (syncError) {
        console.error(`[Calendar] Sync failed for connection ${connection.id}:`, syncError);
      }
    }

    const response: CalendarSyncResponse = {
      synced: syncedCount,
      meetings_created: meetingsCreated,
      meetings_updated: meetingsUpdated,
    };

    res.json(response);
  })
);

/**
 * Sync a single calendar connection (routes to appropriate provider)
 */
async function syncCalendarConnection(
  connection: CalendarConnection
): Promise<{ created: number; updated: number }> {
  if (connection.provider === 'microsoft') {
    return syncMicrosoftCalendarConnection(connection);
  }
  return syncGoogleCalendarConnection(connection);
}

/**
 * Sync a Google calendar connection
 */
async function syncGoogleCalendarConnection(
  connection: CalendarConnection
): Promise<{ created: number; updated: number }> {
  let accessToken = decryptToken(connection.access_token);
  let connectionUpdates: Partial<CalendarConnection> = {};

  // Check if token needs refresh
  if (new Date(connection.token_expires_at) < new Date()) {
    if (!connection.refresh_token) {
      throw new Error('Token expired and no refresh token available');
    }

    const refreshToken = decryptToken(connection.refresh_token);
    const newTokens = await GoogleCalendarService.refreshToken(refreshToken);

    accessToken = newTokens.access_token;
    connectionUpdates = {
      access_token: encryptToken(newTokens.access_token),
      token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    };
  }

  // Fetch events (next 14 days)
  const events = await GoogleCalendarService.getUpcomingEvents(accessToken, 14);

  let created = 0;
  let updated = 0;

  // Process events
  for (const event of events) {
    const joinUrl = extractMeetingUrl(event);

    // Skip events without video meeting URLs
    if (!joinUrl) continue;

    const platform = detectPlatformFromUrl(joinUrl);
    const scheduledStart = event.start.dateTime || event.start.date;
    const scheduledEnd = event.end?.dateTime || event.end?.date;

    if (!scheduledStart) continue;

    // Check if meeting already exists
    const { data: existing } = await supabaseAdmin
      .from('meetings')
      .select('id, calendar_event_etag')
      .eq('user_id', connection.user_id)
      .eq('calendar_event_id', event.id)
      .single();

    if (existing) {
      // Update if etag changed
      if (existing.calendar_event_etag !== event.etag) {
        await supabaseAdmin
          .from('meetings')
          .update({
            title: event.summary || 'Untitled Meeting',
            description: event.description || null,
            platform,
            join_url: joinUrl,
            scheduled_start: scheduledStart,
            scheduled_end: scheduledEnd || null,
            timezone: event.start.timeZone || 'UTC',
            calendar_event_etag: event.etag,
          })
          .eq('id', existing.id);
        updated++;
      }
    } else {
      // Create new meeting
      await supabaseAdmin.from('meetings').insert({
        user_id: connection.user_id,
        source: 'calendar',
        calendar_connection_id: connection.id,
        calendar_event_id: event.id,
        calendar_event_etag: event.etag,
        title: event.summary || 'Untitled Meeting',
        description: event.description || null,
        platform,
        join_url: joinUrl,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd || null,
        timezone: event.start.timeZone || 'UTC',
        auto_join: false,
        status: 'scheduled',
      });
      created++;
    }
  }

  // Update connection with sync timestamp and any token updates
  await supabaseAdmin
    .from('calendar_connections')
    .update({
      ...connectionUpdates,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', connection.id);

  console.log(
    `[Calendar] Synced Google connection ${connection.id}: ${created} created, ${updated} updated`
  );

  return { created, updated };
}

/**
 * Sync a Microsoft calendar connection
 */
async function syncMicrosoftCalendarConnection(
  connection: CalendarConnection
): Promise<{ created: number; updated: number }> {
  let accessToken = decryptToken(connection.access_token);
  let connectionUpdates: Partial<CalendarConnection> = {};

  // Check if token needs refresh
  if (new Date(connection.token_expires_at) < new Date()) {
    if (!connection.refresh_token) {
      throw new Error('Token expired and no refresh token available');
    }

    const refreshToken = decryptToken(connection.refresh_token);
    const newTokens = await MicrosoftCalendarService.refreshToken(refreshToken);

    accessToken = newTokens.access_token;
    connectionUpdates = {
      access_token: encryptToken(newTokens.access_token),
      token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
    };

    // Microsoft may return a new refresh token
    if (newTokens.refresh_token) {
      connectionUpdates.refresh_token = encryptToken(newTokens.refresh_token);
    }
  }

  // Fetch events (next 14 days)
  const events = await MicrosoftCalendarService.getUpcomingEvents(accessToken, 14);

  let created = 0;
  let updated = 0;

  // Process events
  for (const event of events) {
    const joinUrl = extractMicrosoftMeetingUrl(event);

    // Skip events without video meeting URLs
    if (!joinUrl) continue;

    const platform = detectMicrosoftPlatformFromUrl(joinUrl);
    const scheduledStart = event.start.dateTime;
    const scheduledEnd = event.end?.dateTime;

    if (!scheduledStart) continue;

    // Check if meeting already exists (use changeKey as etag equivalent)
    const { data: existing } = await supabaseAdmin
      .from('meetings')
      .select('id, calendar_event_etag')
      .eq('user_id', connection.user_id)
      .eq('calendar_event_id', event.id)
      .single();

    if (existing) {
      // Update if changeKey changed
      if (existing.calendar_event_etag !== event.changeKey) {
        await supabaseAdmin
          .from('meetings')
          .update({
            title: event.subject || 'Untitled Meeting',
            description: event.bodyPreview || null,
            platform,
            join_url: joinUrl,
            scheduled_start: scheduledStart,
            scheduled_end: scheduledEnd || null,
            timezone: event.start.timeZone || 'UTC',
            calendar_event_etag: event.changeKey,
          })
          .eq('id', existing.id);
        updated++;
      }
    } else {
      // Create new meeting
      await supabaseAdmin.from('meetings').insert({
        user_id: connection.user_id,
        source: 'calendar',
        calendar_connection_id: connection.id,
        calendar_event_id: event.id,
        calendar_event_etag: event.changeKey,
        title: event.subject || 'Untitled Meeting',
        description: event.bodyPreview || null,
        platform,
        join_url: joinUrl,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd || null,
        timezone: event.start.timeZone || 'UTC',
        auto_join: false,
        status: 'scheduled',
      });
      created++;
    }
  }

  // Update connection with sync timestamp and any token updates
  await supabaseAdmin
    .from('calendar_connections')
    .update({
      ...connectionUpdates,
      last_synced_at: new Date().toISOString(),
    })
    .eq('id', connection.id);

  console.log(
    `[Calendar] Synced Microsoft connection ${connection.id}: ${created} created, ${updated} updated`
  );

  return { created, updated };
}

export default router;
