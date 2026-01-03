/**
 * Microsoft Calendar Service
 * OAuth2 and Microsoft Graph API integration for Outlook/Teams calendars
 */

import { MeetingPlatform } from '../types/meetings.js';
import { config } from '../config/index.js';

// OAuth scopes for Microsoft Graph API
const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access', // Required for refresh token
  'User.Read', // Required for /me endpoint
  'Calendars.Read',
];

// Microsoft Graph API base URL
const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Microsoft token response from OAuth
 */
export interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

/**
 * Microsoft user info from Graph API
 */
export interface MicrosoftUserInfo {
  id: string;
  mail: string | null;
  userPrincipalName: string;
  displayName: string | null;
}

/**
 * Microsoft Calendar Event from Graph API
 */
export interface MicrosoftCalendarEvent {
  id: string;
  changeKey: string; // Similar to Google's etag
  subject: string;
  bodyPreview?: string;
  body?: {
    contentType: string;
    content: string;
  };
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName?: string;
  };
  isOnlineMeeting: boolean;
  onlineMeetingUrl?: string;
  onlineMeeting?: {
    joinUrl?: string;
  };
  webLink?: string;
  attendees?: Array<{
    emailAddress: {
      address: string;
      name?: string;
    };
    status?: {
      response: string;
    };
  }>;
}

/**
 * Microsoft Calendar Service
 */
export class MicrosoftCalendarService {
  /**
   * Generate OAuth authorization URL
   */
  static getAuthUrl(state: string): string {
    if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_REDIRECT_URI) {
      throw new Error('Microsoft OAuth not configured');
    }

    const tenantId = config.MICROSOFT_TENANT_ID || 'common';

    const params = new URLSearchParams({
      client_id: config.MICROSOFT_CLIENT_ID,
      redirect_uri: config.MICROSOFT_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES.join(' '),
      response_mode: 'query',
      state,
      prompt: 'consent', // Always show consent to ensure refresh token
    });

    return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCode(code: string): Promise<MicrosoftTokenResponse> {
    if (
      !config.MICROSOFT_CLIENT_ID ||
      !config.MICROSOFT_CLIENT_SECRET ||
      !config.MICROSOFT_REDIRECT_URI
    ) {
      throw new Error('Microsoft OAuth not configured');
    }

    const tenantId = config.MICROSOFT_TENANT_ID || 'common';

    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          client_id: config.MICROSOFT_CLIENT_ID,
          client_secret: config.MICROSOFT_CLIENT_SECRET,
          redirect_uri: config.MICROSOFT_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[Microsoft OAuth] Token exchange failed:', error);
      throw new Error('Failed to exchange code for tokens');
    }

    return response.json() as Promise<MicrosoftTokenResponse>;
  }

  /**
   * Refresh an expired access token
   */
  static async refreshToken(refreshToken: string): Promise<MicrosoftTokenResponse> {
    if (!config.MICROSOFT_CLIENT_ID || !config.MICROSOFT_CLIENT_SECRET) {
      throw new Error('Microsoft OAuth not configured');
    }

    const tenantId = config.MICROSOFT_TENANT_ID || 'common';

    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: config.MICROSOFT_CLIENT_ID,
          client_secret: config.MICROSOFT_CLIENT_SECRET,
          grant_type: 'refresh_token',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[Microsoft OAuth] Token refresh failed:', error);
      throw new Error('Failed to refresh token');
    }

    return response.json() as Promise<MicrosoftTokenResponse>;
  }

  /**
   * Get user info from Microsoft Graph
   */
  static async getUserInfo(accessToken: string): Promise<MicrosoftUserInfo> {
    const response = await fetch(`${GRAPH_API_BASE}/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Microsoft Graph] Failed to get user info:', error);
      throw new Error('Failed to get user info');
    }

    return response.json() as Promise<MicrosoftUserInfo>;
  }

  /**
   * Get upcoming calendar events from Microsoft Graph
   */
  static async getUpcomingEvents(
    accessToken: string,
    daysAhead: number = 14
  ): Promise<MicrosoftCalendarEvent[]> {
    const startDateTime = new Date().toISOString();
    const endDateTime = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

    const params = new URLSearchParams({
      startDateTime,
      endDateTime,
      $orderby: 'start/dateTime',
      $top: '100',
      $select:
        'id,changeKey,subject,bodyPreview,body,start,end,location,isOnlineMeeting,onlineMeetingUrl,onlineMeeting,webLink,attendees',
    });

    const response = await fetch(
      `${GRAPH_API_BASE}/me/calendarView?${params}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('[Microsoft Graph] Failed to fetch events:', error);
      throw new Error('Failed to fetch calendar events');
    }

    const data = (await response.json()) as { value?: MicrosoftCalendarEvent[] };
    return data.value || [];
  }

  /**
   * Revoke OAuth tokens (Microsoft doesn't have a simple revoke endpoint)
   * The best practice is to just delete the stored tokens
   */
  static async revokeToken(_token: string): Promise<void> {
    // Microsoft doesn't have a simple token revocation endpoint like Google
    // The token will expire naturally, and we just remove it from our storage
    console.log('[Microsoft OAuth] Token removed from storage (no direct revoke API)');
  }
}

/**
 * Extract meeting URL from a Microsoft calendar event
 */
export function extractMicrosoftMeetingUrl(event: MicrosoftCalendarEvent): string | null {
  // 1. Check onlineMeetingUrl (Teams meetings)
  if (event.onlineMeetingUrl) {
    return event.onlineMeetingUrl;
  }

  // 2. Check onlineMeeting object
  if (event.onlineMeeting?.joinUrl) {
    return event.onlineMeeting.joinUrl;
  }

  // 3. Search body content for meeting URLs
  const text = `${event.bodyPreview || ''} ${event.body?.content || ''} ${event.location?.displayName || ''}`;

  const urlPatterns = [
    // Microsoft Teams URLs
    /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<"')\\]+/gi,
    /https?:\/\/teams\.live\.com\/meet\/[^\s<"')\\]+/gi,
    // Zoom URLs
    /https?:\/\/[\w.-]*zoom\.us\/j\/\d+[^\s<"')\\]*/gi,
    /https?:\/\/[\w.-]*zoom\.com\/j\/\d+[^\s<"')\\]*/gi,
    // Google Meet URLs
    /https?:\/\/meet\.google\.com\/[\w-]+/gi,
    // Webex URLs
    /https?:\/\/[\w.-]*\.webex\.com\/[\w.-]+\/j\.php[^\s<"')\\]*/gi,
    /https?:\/\/[\w.-]*\.webex\.com\/meet\/[^\s<"')\\]+/gi,
    // GoTo Meeting URLs
    /https?:\/\/[\w.-]*gotomeet\.me\/[^\s<"')\\]+/gi,
    /https?:\/\/[\w.-]*gotomeeting\.com\/join\/[^\s<"')\\]+/gi,
    // Other platforms...
    /https?:\/\/chime\.aws\/\d+[^\s<"')\\]*/gi,
    /https?:\/\/[\w.-]*bluejeans\.com\/\d+[^\s<"')\\]*/gi,
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
 * Detect meeting platform from URL (reuse from Google service or use common function)
 */
export function detectMicrosoftPlatformFromUrl(url: string): MeetingPlatform {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('teams.microsoft.com') || lowerUrl.includes('teams.live.com')) {
    return 'teams';
  }

  if (lowerUrl.includes('zoom.us') || lowerUrl.includes('zoom.com')) {
    return 'zoom';
  }

  if (lowerUrl.includes('meet.google.com')) {
    return 'google_meet';
  }

  if (lowerUrl.includes('webex.com')) {
    return 'webex';
  }

  if (
    lowerUrl.includes('gotomeet.me') ||
    lowerUrl.includes('gotomeeting.com') ||
    lowerUrl.includes('goto.com')
  ) {
    return 'goto_meeting';
  }

  if (lowerUrl.includes('chime.aws')) {
    return 'chime';
  }

  if (lowerUrl.includes('bluejeans.com')) {
    return 'bluejeans';
  }

  return 'unknown';
}
