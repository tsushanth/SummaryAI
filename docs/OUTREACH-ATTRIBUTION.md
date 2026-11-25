# Outreach attribution (MeetingMind backend)

Reports signups and the first activation of people who arrived through an outreach email link to the shared outreach metrics layer
(Calldesk `docs/OUTREACH-METRICS.md`, `POST /api/outreach/event`). Code: `backend/src/services/outreachEvents.ts`,
`backend/src/services/outreachActivation.ts`, the attribution handler in `backend/src/routes/activation.ts`, the hook in `processingService.ts`.

## What is reported
- `signup`: when `POST /api/activation/attribution` (Bearer user) carries `utm_source=outreach` and a valid `utm_campaign`, and the first
  touch is new (or `ACTIVATION_EVENTS_ENABLED` is off, in which case nothing is stored here). `link_code` is `utm_content` when the client
  sends it (neither the web client nor Android does today, the layer joins on the email hash instead).
- `activated`: first completed recording (`processingService` step 9), only for users whose `signup_attribution` row is an outreach one.
  At most one lookup per user per process; the layer keeps one `activated` row per user and campaign.
- The email goes only in the signed body; the layer hashes it with its pepper and never stores it. Logs carry event, campaign and status only.

## Off by default
Nothing runs unless `OUTREACH_EVENTS_URL` (https) and a secret (`OUTREACH_EVENT_SECRET_MEETINGMIND`, else `OUTREACH_EVENT_SECRET`) are set.
Fire and forget, 2 s timeout, one background retry on network error / 5xx / 429, all errors swallowed.

## Enable (after the Calldesk layer is verified live)
```
flyctl secrets set -a summary-ai-backend OUTREACH_EVENT_SECRET=<same value as calldesk-tech> OUTREACH_EVENTS_URL=https://calldesk.tech/api/outreach/event
```
Also needed for attribution to exist at all: `ACTIVATION_EVENTS_ENABLED=true` on this app (migration 027 applied) so clients' attribution
posts are stored, and the announcement links must be the layer's `/o/<campaign>/<code>` redirects (they add the utm params).

## Without link attribution
`docs/outreach-baseline.sql`: signups in the 14 days after a send vs the 14 days before.
