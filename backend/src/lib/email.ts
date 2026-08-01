/**
 * Shared email sender — all apps use mail.kreativekoala.llc as the verified
 * Resend domain so only one DNS setup is needed across every project.
 *
 * From address format:  AppName <appslug@mail.kreativekoala.llc>
 * Recipients see the app name; the domain is invisible to them.
 *
 * Setup (one-time):
 *   1. In Resend dashboard → Domains → Add Domain → "send.kreativekoala.llc"
 *   2. Add the DKIM / SPF records Resend shows to kreativekoala.llc DNS (as subdomain records)
 *   3. Set RESEND_API_KEY in each project's environment
 *
 * Usage:
 *   import { sendEmail } from '../lib/email'
 *   await sendEmail({ app: 'meetingmind', to: user.email, subject: '…', html: '…' })
 */

import { Resend } from 'resend'

// ── App registry ─────────────────────────────────────────────────────────────
// Add a new entry here whenever a new app needs to send email.

const APP_NAMES: Record<string, string> = {
  meetingmind: 'Meeting Mind',
  audexa:      'Audexa',
  vibebuild:   'VibeBuild',
  readaloudai: 'ReadAloud AI',
  scribeai:    'ScribeAI',
  clearvoice:  'ClearVoice',
  pdfgenius:   'PDFGenius',
  riddleverse: 'RiddleVerse',
  leanhealth:  'LeanPathMD',
  sketchly:    'Sketchly',
}

// Use a subdomain so kreativekoala.llc's existing SPF (Cloudflare Email)
// is not affected. Resend gives send.kreativekoala.llc its own clean DNS.
const SENDING_DOMAIN = 'send.kreativekoala.llc'

// ── Client ───────────────────────────────────────────────────────────────────

let _resend: Resend | null = null
function client(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SendEmailOptions {
  /** App slug — must match a key in APP_NAMES above */
  app: string
  to: string | string[]
  subject: string
  html: string
  /** Override the reply-to address (defaults to app@mail.kreativekoala.llc) */
  replyTo?: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const appName = APP_NAMES[opts.app]
  if (!appName) throw new Error(`Unknown app slug "${opts.app}". Add it to APP_NAMES in src/lib/email.ts`)

  const from = `${appName} <${opts.app}@${SENDING_DOMAIN}>`

  await client().emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
  })
}

/** Convenience: build the from string without sending (useful for logging/debugging) */
export function fromAddress(app: string): string {
  const appName = APP_NAMES[app] ?? app
  return `${appName} <${app}@${SENDING_DOMAIN}>`
}
