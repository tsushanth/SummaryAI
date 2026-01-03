/**
 * Google Calendar Service
 * OAuth2 and Calendar API integration
 */

import {
  GoogleCalendarEvent,
  GoogleTokenResponse,
  GoogleUserInfo,
  MeetingPlatform,
} from '../types/meetings.js';
import { config } from '../config/index.js';

// OAuth scopes
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Google Calendar Service
 */
export class GoogleCalendarService {
  /**
   * Generate OAuth authorization URL
   */
  static getAuthUrl(state: string): string {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_REDIRECT_URI) {
      throw new Error('Google OAuth not configured');
    }

    const params = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline', // Get refresh token
      prompt: 'consent', // Always show consent screen to ensure refresh token
      state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCode(code: string): Promise<GoogleTokenResponse> {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET || !config.GOOGLE_REDIRECT_URI) {
      throw new Error('Google OAuth not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        redirect_uri: config.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Google OAuth] Token exchange failed:', error);
      throw new Error('Failed to exchange code for tokens');
    }

    return response.json() as Promise<GoogleTokenResponse>;
  }

  /**
   * Refresh an expired access token
   */
  static async refreshToken(refreshToken: string): Promise<GoogleTokenResponse> {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth not configured');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.GOOGLE_CLIENT_ID,
        client_secret: config.GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Google OAuth] Token refresh failed:', error);
      throw new Error('Failed to refresh token');
    }

    return response.json() as Promise<GoogleTokenResponse>;
  }

  /**
   * Get user info from Google
   */
  static async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    return response.json() as Promise<GoogleUserInfo>;
  }

  /**
   * Get upcoming calendar events
   */
  static async getUpcomingEvents(
    accessToken: string,
    daysAhead: number = 14
  ): Promise<GoogleCalendarEvent[]> {
    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[Google Calendar] Failed to fetch events:', error);
      throw new Error('Failed to fetch calendar events');
    }

    const data = await response.json() as { items?: GoogleCalendarEvent[] };
    return data.items || [];
  }

  /**
   * Revoke OAuth tokens
   */
  static async revokeToken(token: string): Promise<void> {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
        method: 'POST',
      });
    } catch (error) {
      console.warn('[Google OAuth] Token revocation failed:', error);
    }
  }
}

/**
 * Extract meeting URL from a calendar event
 */
export function extractMeetingUrl(event: GoogleCalendarEvent): string | null {
  // 1. Check conferenceData (Google Meet, Zoom via Calendar integration)
  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(
      (e) => e.entryPointType === 'video'
    );
    if (videoEntry?.uri) {
      return videoEntry.uri;
    }
  }

  // 2. Check hangoutLink (Google Meet)
  if (event.hangoutLink) {
    return event.hangoutLink;
  }

  // 3. Search description and location for meeting URLs
  const text = `${event.description || ''} ${event.location || ''}`;

  const urlPatterns = [
    // Zoom URLs
    /https?:\/\/[\w.-]*zoom\.us\/j\/\d+[^\s<"')\\]*/gi,
    /https?:\/\/[\w.-]*zoom\.com\/j\/\d+[^\s<"')\\]*/gi,
    // Google Meet URLs
    /https?:\/\/meet\.google\.com\/[\w-]+/gi,
    // Microsoft Teams URLs
    /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<"')\\]+/gi,
    /https?:\/\/teams\.live\.com\/meet\/[^\s<"')\\]+/gi,
    // Webex URLs
    /https?:\/\/[\w.-]*\.webex\.com\/[\w.-]+\/j\.php[^\s<"')\\]*/gi,
    /https?:\/\/[\w.-]*\.webex\.com\/meet\/[^\s<"')\\]+/gi,
    // GoTo Meeting URLs
    /https?:\/\/[\w.-]*gotomeet\.me\/[^\s<"')\\]+/gi,
    /https?:\/\/[\w.-]*gotomeeting\.com\/join\/[^\s<"')\\]+/gi,
    /https?:\/\/[\w.-]*goto\.com\/meeting\/[^\s<"')\\]+/gi,
    // Amazon Chime URLs
    /https?:\/\/chime\.aws\/\d+[^\s<"')\\]*/gi,
    // BlueJeans URLs
    /https?:\/\/[\w.-]*bluejeans\.com\/\d+[^\s<"')\\]*/gi,
    // RingCentral URLs
    /https?:\/\/[\w.-]*ringcentral\.com\/j\/[^\s<"')\\]+/gi,
    /https?:\/\/meetings\.ringcentral\.com\/[^\s<"')\\]+/gi,
    // Lifesize URLs
    /https?:\/\/[\w.-]*lifesize\.com\/[^\s<"')\\]+/gi,
    /https?:\/\/call\.lifesizecloud\.com\/[^\s<"')\\]+/gi,
  ];

  for (const pattern of urlPatterns) {
    const match = text.match(pattern);
    if (match && match[0]) {
      return match[0];
    }
  }

  return null;
}

/**
 * Detect meeting platform from URL
 */
export function detectPlatformFromUrl(url: string): MeetingPlatform {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('zoom.us') || lowerUrl.includes('zoom.com')) {
    return 'zoom';
  }

  if (lowerUrl.includes('meet.google.com')) {
    return 'google_meet';
  }

  if (lowerUrl.includes('teams.microsoft.com') || lowerUrl.includes('teams.live.com')) {
    return 'teams';
  }

  if (lowerUrl.includes('webex.com')) {
    return 'webex';
  }

  if (lowerUrl.includes('gotomeet.me') || lowerUrl.includes('gotomeeting.com') || lowerUrl.includes('goto.com')) {
    return 'goto_meeting';
  }

  if (lowerUrl.includes('chime.aws')) {
    return 'chime';
  }

  if (lowerUrl.includes('bluejeans.com')) {
    return 'bluejeans';
  }

  if (lowerUrl.includes('ringcentral.com')) {
    return 'ringcentral';
  }

  if (lowerUrl.includes('lifesize.com') || lowerUrl.includes('lifesizecloud.com')) {
    return 'lifesize';
  }

  if (lowerUrl.includes('slack.com') && lowerUrl.includes('huddle')) {
    return 'slack';
  }

  return 'unknown';
}

/**
 * Check if an event is a video meeting
 */
export function isVideoMeeting(event: GoogleCalendarEvent): boolean {
  if (event.conferenceData?.entryPoints?.some((e) => e.entryPointType === 'video')) {
    return true;
  }

  if (event.hangoutLink) {
    return true;
  }

  return extractMeetingUrl(event) !== null;
}

/**
 * Generate OAuth state token for CSRF protection
 */
export function generateOAuthState(
  userId: string,
  nonce?: string
): string {
  const stateData = {
    userId,
    timestamp: Date.now(),
    nonce: nonce || Math.random().toString(36).substring(2),
  };

  return Buffer.from(JSON.stringify(stateData)).toString('base64url');
}

/**
 * Parse OAuth state token
 */
export function parseOAuthState(state: string): {
  userId: string;
  timestamp: number;
  nonce: string;
} | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}
