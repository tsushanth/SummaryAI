/**
 * Meeting Mind — Email Drip Sequence Script
 *
 * Runs all three touches of the drip sequence in one pass.
 * Safe to run daily via cron — each touch is idempotent (tracked in user_emails).
 *
 * Touch 1 (promo_1): New users 24h+ old who haven't received any email yet
 * Touch 2 (promo_2): Users who got promo_1 3+ days ago, still not subscribed
 * Touch 3 (promo_3): Users who got promo_2 7+ days ago, still not subscribed
 *
 * Prerequisites:
 *  - RESEND_API_KEY        — from Resend dashboard
 *  - SUPABASE_URL          — project URL
 *  - SUPABASE_SERVICE_ROLE_KEY — service role key
 *  - PLAY_KEY_FILE         — path to GCP service account JSON (optional, skips Play offer step if missing)
 *
 * Usage:
 *   export RESEND_API_KEY=re_xxxx
 *   export SUPABASE_URL=https://xxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   npx tsx scripts/send-promo.ts
 *
 * Optional flags:
 *   DRY_RUN=true          — log what would be sent without actually sending
 *   SKIP_PLAY=true        — skip the Google Play offer creation step
 *   STEP=1|2|3            — only run a specific touch (default: all)
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../src/lib/email.js";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });

// ── Config ────────────────────────────────────────────────────────────────────

const PACKAGE_NAME = "com.kreativekoala.meetingmind";
const PRODUCT_ID = process.env.PRODUCT_ID ?? "yearly";
const OFFER_ID = process.env.OFFER_ID ?? "mm2024promo";
const DRY_RUN = process.env.DRY_RUN === "true";
const SKIP_PLAY = process.env.SKIP_PLAY === "true";
const ONLY_STEP = process.env.STEP ? parseInt(process.env.STEP) : null;

const PLAY_KEY_FILE =
  process.env.PLAY_KEY_FILE ??
  "/Users/sushanthtiruvaipati/Downloads/summaryai-483115-a27fc5121150.json";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const redeemUrl = `https://play.google.com/redeem?code=${OFFER_ID}`;

// Delay thresholds for each touch
const TOUCH2_DELAY_DAYS = 3;
const TOUCH3_DELAY_DAYS = 7;
// Touch 1 goes to users who signed up at least 24h ago
const TOUCH1_DELAY_HOURS = 24;

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function requireEnv(name: string) {
  if (!process.env[name]) {
    console.error(`ERROR: missing env var ${name}`);
    process.exit(1);
  }
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function hoursAgo(n: number): string {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

// ── Google Play Developer API ─────────────────────────────────────────────────

async function buildPlayClient() {
  const { google } = await import("googleapis");
  if (!fs.existsSync(PLAY_KEY_FILE)) {
    throw new Error(`Service account key not found at: ${PLAY_KEY_FILE}`);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: PLAY_KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const authClient = await auth.getClient();
  return google.androidpublisher({ version: "v3", auth: authClient as any });
}

async function ensureOfferActive(): Promise<void> {
  log("Setting up Google Play promotional offer…");
  try {
    const { google } = await import("googleapis");
    const play = await buildPlayClient();

    // Find active base plan
    const res = await play.monetization.subscriptions.get({
      packageName: PACKAGE_NAME,
      productId: PRODUCT_ID,
    });
    const basePlans = res.data.basePlans ?? [];
    const active = basePlans.find((bp) => bp.state === "ACTIVE") ?? basePlans[0];
    if (!active) throw new Error("No base plans found");
    const basePlanId = active.basePlanId!;
    log(`Using base plan: "${basePlanId}"`);

    // Create offer (idempotent)
    try {
      await play.monetization.subscriptions.basePlans.offers.create({
        packageName: PACKAGE_NAME,
        productId: PRODUCT_ID,
        basePlanId,
        offerId: OFFER_ID,
        "regionsVersion.version": "2022/02",
        requestBody: {
          offerId: OFFER_ID,
          regionalConfigs: [{ regionCode: "US", newSubscriberAvailability: true }],
          phases: [
            {
              duration: "P1M",
              recurrenceCount: 1,
              regionalConfigs: [{ regionCode: "US", free: {} }],
            },
          ],
          offerTags: [{ tag: "promo2024" }],
        },
      });
      log("Offer created.");
    } catch (err: any) {
      if (err?.code === 409 || err?.status === 409) {
        log("Offer already exists.");
      } else {
        throw err;
      }
    }

    // Activate
    try {
      await play.monetization.subscriptions.basePlans.offers.activate({
        packageName: PACKAGE_NAME,
        productId: PRODUCT_ID,
        basePlanId,
        offerId: OFFER_ID,
        requestBody: {},
      });
      log("Offer is ACTIVE.");
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.toLowerCase().includes("already") || err?.code === 400) {
        log("Offer was already active.");
      } else {
        throw err;
      }
    }
  } catch (err) {
    log(`WARNING: Could not set up Play offer: ${(err as Error).message}`);
    log("Continuing with email sends…");
  }
}

// ── Supabase ──────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  subscription_status: string | null;
}

/** Users who signed up 24h+ ago, not subscribed, and haven't received ANY email */
async function getTouch1Users(): Promise<Profile[]> {
  log("Fetching Touch 1 candidates (new users, no prior email)…");
  const supabase = getSupabase();

  // Get all non-subscribed users created 24h+ ago
  const { data: candidates, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, subscription_status")
    .or(
      "subscription_status.is.null,subscription_status.eq.free,subscription_status.eq.canceled,subscription_status.eq.past_due"
    )
    .not("email", "is", null)
    .lt("created_at", hoursAgo(TOUCH1_DELAY_HOURS));

  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  const allCandidates = (candidates ?? []) as Profile[];

  // Exclude users who already received any email
  const ids = allCandidates.map((u) => u.id);
  if (ids.length === 0) return [];

  const { data: alreadySent } = await supabase
    .from("user_emails")
    .select("user_id")
    .in("user_id", ids);

  const sentIds = new Set((alreadySent ?? []).map((r: any) => r.user_id));
  const users = allCandidates.filter((u) => !sentIds.has(u.id));

  log(`Touch 1: ${users.length} users (from ${allCandidates.length} candidates, ${sentIds.size} already emailed)`);
  return users;
}

/** Users who got promo_1 3+ days ago and still haven't subscribed */
async function getTouch2Users(): Promise<Profile[]> {
  log(`Fetching Touch 2 candidates (got promo_1 ${TOUCH2_DELAY_DAYS}+ days ago)…`);
  const supabase = getSupabase();

  // Find users who got promo_1 but NOT promo_2, sent 3+ days ago
  const { data: touch1Sent, error: e1 } = await supabase
    .from("user_emails")
    .select("user_id")
    .eq("template", "promo_1")
    .lt("sent_at", daysAgo(TOUCH2_DELAY_DAYS));

  if (e1) throw new Error(`user_emails query failed: ${e1.message}`);

  const touch1Ids = (touch1Sent ?? []).map((r: any) => r.user_id);
  if (touch1Ids.length === 0) return [];

  // Exclude those who already got promo_2
  const { data: touch2Sent } = await supabase
    .from("user_emails")
    .select("user_id")
    .eq("template", "promo_2")
    .in("user_id", touch1Ids);

  const alreadyTouch2 = new Set((touch2Sent ?? []).map((r: any) => r.user_id));
  const eligibleIds = touch1Ids.filter((id: string) => !alreadyTouch2.has(id));

  if (eligibleIds.length === 0) return [];

  // Fetch only non-subscribed users
  const { data: profiles, error: e2 } = await supabase
    .from("profiles")
    .select("id, email, display_name, subscription_status")
    .in("id", eligibleIds)
    .or(
      "subscription_status.is.null,subscription_status.eq.free,subscription_status.eq.canceled,subscription_status.eq.past_due"
    )
    .not("email", "is", null);

  if (e2) throw new Error(`profiles query failed: ${e2.message}`);

  const users = (profiles ?? []) as Profile[];
  log(`Touch 2: ${users.length} users eligible`);
  return users;
}

/** Users who got promo_2 7+ days ago and still haven't subscribed */
async function getTouch3Users(): Promise<Profile[]> {
  log(`Fetching Touch 3 candidates (got promo_2 ${TOUCH3_DELAY_DAYS}+ days ago)…`);
  const supabase = getSupabase();

  const { data: touch2Sent, error: e1 } = await supabase
    .from("user_emails")
    .select("user_id")
    .eq("template", "promo_2")
    .lt("sent_at", daysAgo(TOUCH3_DELAY_DAYS));

  if (e1) throw new Error(`user_emails query failed: ${e1.message}`);

  const touch2Ids = (touch2Sent ?? []).map((r: any) => r.user_id);
  if (touch2Ids.length === 0) return [];

  // Exclude those who already got promo_3
  const { data: touch3Sent } = await supabase
    .from("user_emails")
    .select("user_id")
    .eq("template", "promo_3")
    .in("user_id", touch2Ids);

  const alreadyTouch3 = new Set((touch3Sent ?? []).map((r: any) => r.user_id));
  const eligibleIds = touch2Ids.filter((id: string) => !alreadyTouch3.has(id));

  if (eligibleIds.length === 0) return [];

  const { data: profiles, error: e2 } = await supabase
    .from("profiles")
    .select("id, email, display_name, subscription_status")
    .in("id", eligibleIds)
    .or(
      "subscription_status.is.null,subscription_status.eq.free,subscription_status.eq.canceled,subscription_status.eq.past_due"
    )
    .not("email", "is", null);

  if (e2) throw new Error(`profiles query failed: ${e2.message}`);

  const users = (profiles ?? []) as Profile[];
  log(`Touch 3: ${users.length} users eligible`);
  return users;
}

/** Record an email send in user_emails */
async function recordSend(userId: string, email: string, template: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("user_emails").insert({
    user_id: userId,
    email,
    template,
    sent_at: new Date().toISOString(),
    status: "sent",
  });
}

// ── Email Templates ───────────────────────────────────────────────────────────

function buildTouch1Html(name: string | null): string {
  const firstName = name?.split(" ")[0] ?? "there";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your exclusive Meeting Mind offer</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f5f5f7; margin: 0; padding: 0; color: #1d1d1f; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #ffffff;
               border-radius: 16px; overflow: hidden;
               box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #6C63FF 0%, #9C27B0 100%);
              padding: 40px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; }
    .header p  { color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 15px; }
    .body { padding: 32px; }
    .body p { font-size: 15px; line-height: 1.6; margin: 0 0 16px; color: #3a3a3c; }
    .code-box { background: #f5f5f7; border: 2px dashed #6C63FF;
                border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .code-box .label { font-size: 12px; font-weight: 600; color: #6C63FF;
                       letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
    .code-box .code { font-size: 26px; font-weight: 800; color: #1d1d1f;
                      font-family: 'Courier New', monospace; letter-spacing: 2px; }
    .cta { display: block; background: linear-gradient(135deg, #6C63FF 0%, #9C27B0 100%);
           color: #ffffff !important; text-decoration: none; text-align: center;
           padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700;
           margin: 24px 0; }
    .fine-print { font-size: 12px; color: #8e8e93; line-height: 1.5; margin-top: 24px; }
    .footer { background: #f5f5f7; padding: 20px 32px; text-align: center;
              font-size: 12px; color: #8e8e93; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🎙️ Meeting Mind</h1>
      <p>An exclusive offer, just for you</p>
    </div>
    <div class="body">
      <p>Hey ${firstName},</p>
      <p>
        Welcome to Meeting Mind! We noticed you haven't upgraded to Pro yet —
        so here's a little nudge with something special.
      </p>
      <p>
        Use the offer code below to unlock <strong>1 month FREE</strong> on our
        yearly plan. That's unlimited recordings, AI summaries, smart search,
        and cloud storage — everything you need to never lose track of what was
        said in your meetings.
      </p>

      <div class="code-box">
        <div class="label">Your offer code</div>
        <div class="code">${OFFER_ID.toUpperCase()}</div>
      </div>

      <a class="cta" href="${redeemUrl}">
        Redeem on Google Play →
      </a>

      <p>
        Or open the Meeting Mind app, tap <strong>Upgrade</strong>, then
        <em>"Have an offer code?"</em> and enter the code above.
      </p>

      <p class="fine-print">
        Offer valid for new and returning subscribers. One free month applies to
        the first billing period of the annual plan. Subsequent renewals billed
        at the standard yearly rate. Redeemable on Android only.
      </p>
    </div>
    <div class="footer">
      © Meeting Mind · <a href="https://meetingmind.org">meetingmind.org</a><br />
      You're receiving this because you have a Meeting Mind account.
    </div>
  </div>
</body>
</html>`;
}

function buildTouch2Html(name: string | null): string {
  const firstName = name?.split(" ")[0] ?? "there";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Still missing your Meeting Mind recordings?</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f5f5f7; margin: 0; padding: 0; color: #1d1d1f; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #ffffff;
               border-radius: 16px; overflow: hidden;
               box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #6C63FF 0%, #9C27B0 100%);
              padding: 40px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; }
    .header p  { color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 15px; }
    .body { padding: 32px; }
    .body p { font-size: 15px; line-height: 1.6; margin: 0 0 16px; color: #3a3a3c; }
    .features { background: #f9f9fb; border-radius: 12px; padding: 20px; margin: 20px 0; }
    .feature { display: flex; align-items: flex-start; margin-bottom: 14px; }
    .feature:last-child { margin-bottom: 0; }
    .feature-icon { font-size: 20px; margin-right: 12px; flex-shrink: 0; }
    .feature-text { font-size: 14px; color: #3a3a3c; line-height: 1.5; }
    .feature-text strong { color: #1d1d1f; }
    .code-box { background: #f5f5f7; border: 2px dashed #6C63FF;
                border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .code-box .label { font-size: 12px; font-weight: 600; color: #6C63FF;
                       letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
    .code-box .code { font-size: 26px; font-weight: 800; color: #1d1d1f;
                      font-family: 'Courier New', monospace; letter-spacing: 2px; }
    .cta { display: block; background: linear-gradient(135deg, #6C63FF 0%, #9C27B0 100%);
           color: #ffffff !important; text-decoration: none; text-align: center;
           padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700;
           margin: 24px 0; }
    .fine-print { font-size: 12px; color: #8e8e93; line-height: 1.5; margin-top: 24px; }
    .footer { background: #f5f5f7; padding: 20px 32px; text-align: center;
              font-size: 12px; color: #8e8e93; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🎙️ Meeting Mind</h1>
      <p>Still on the fence? Here's what you're missing</p>
    </div>
    <div class="body">
      <p>Hey ${firstName},</p>
      <p>
        We sent you an offer a few days ago — just wanted to make sure you saw it.
        Meeting Mind Pro users save hours every week. Here's how:
      </p>

      <div class="features">
        <div class="feature">
          <span class="feature-icon">🎤</span>
          <div class="feature-text"><strong>Unlimited recordings</strong> — record any call or meeting with one tap</div>
        </div>
        <div class="feature">
          <span class="feature-icon">✨</span>
          <div class="feature-text"><strong>AI-powered summaries</strong> — get the key points, action items, and decisions without rewatching</div>
        </div>
        <div class="feature">
          <span class="feature-icon">🔍</span>
          <div class="feature-text"><strong>Smart search</strong> — find any moment across all your recordings instantly</div>
        </div>
        <div class="feature">
          <span class="feature-icon">☁️</span>
          <div class="feature-text"><strong>Cloud storage</strong> — access recordings from any device, forever</div>
        </div>
      </div>

      <p>Your offer code is still active:</p>

      <div class="code-box">
        <div class="label">Your offer code</div>
        <div class="code">${OFFER_ID.toUpperCase()}</div>
      </div>

      <a class="cta" href="${redeemUrl}">
        Get 1 Month FREE →
      </a>

      <p class="fine-print">
        Offer valid for new and returning subscribers. One free month on the annual plan.
        Redeemable on Android only.
      </p>
    </div>
    <div class="footer">
      © Meeting Mind · <a href="https://meetingmind.org">meetingmind.org</a><br />
      You're receiving this because you have a Meeting Mind account.
    </div>
  </div>
</body>
</html>`;
}

function buildTouch3Html(name: string | null): string {
  const firstName = name?.split(" ")[0] ?? "there";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Last chance — your Meeting Mind offer expires soon</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #f5f5f7; margin: 0; padding: 0; color: #1d1d1f; }
    .wrapper { max-width: 560px; margin: 40px auto; background: #ffffff;
               border-radius: 16px; overflow: hidden;
               box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #FF6B35 0%, #E91E63 100%);
              padding: 40px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 26px; font-weight: 700; }
    .header p  { color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 15px; }
    .body { padding: 32px; }
    .body p { font-size: 15px; line-height: 1.6; margin: 0 0 16px; color: #3a3a3c; }
    .urgency-box { background: #fff5f5; border: 2px solid #E91E63;
                   border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center; }
    .urgency-box p { color: #c62828; font-weight: 600; font-size: 16px; margin: 0; }
    .code-box { background: #f5f5f7; border: 2px dashed #E91E63;
                border-radius: 12px; padding: 20px; text-align: center; margin: 24px 0; }
    .code-box .label { font-size: 12px; font-weight: 600; color: #E91E63;
                       letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
    .code-box .code { font-size: 26px; font-weight: 800; color: #1d1d1f;
                      font-family: 'Courier New', monospace; letter-spacing: 2px; }
    .cta { display: block; background: linear-gradient(135deg, #FF6B35 0%, #E91E63 100%);
           color: #ffffff !important; text-decoration: none; text-align: center;
           padding: 16px 32px; border-radius: 12px; font-size: 16px; font-weight: 700;
           margin: 24px 0; }
    .fine-print { font-size: 12px; color: #8e8e93; line-height: 1.5; margin-top: 24px; }
    .footer { background: #f5f5f7; padding: 20px 32px; text-align: center;
              font-size: 12px; color: #8e8e93; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>⏰ Last Chance</h1>
      <p>Your Meeting Mind offer is about to expire</p>
    </div>
    <div class="body">
      <p>Hey ${firstName},</p>
      <p>
        This is our final reminder — your exclusive offer for
        <strong>1 month FREE</strong> on Meeting Mind Pro is expiring soon.
        After this email, this offer won't be available to you.
      </p>

      <div class="urgency-box">
        <p>🔥 Offer expires soon — don't miss out</p>
      </div>

      <p>
        Meeting Mind Pro gives you unlimited recordings, AI summaries, smart
        search, and cloud backup. Stop losing track of what was decided in
        your meetings.
      </p>

      <div class="code-box">
        <div class="label">Your offer code</div>
        <div class="code">${OFFER_ID.toUpperCase()}</div>
      </div>

      <a class="cta" href="${redeemUrl}">
        Claim My Free Month Now →
      </a>

      <p style="font-size:13px; color:#8e8e93;">
        If you decide Meeting Mind isn't for you, no worries — this is the
        last email you'll get from us about this offer.
      </p>

      <p class="fine-print">
        Offer valid for new and returning subscribers. One free month on the annual plan.
        Redeemable on Android only.
      </p>
    </div>
    <div class="footer">
      © Meeting Mind · <a href="https://meetingmind.org">meetingmind.org</a><br />
      You're receiving this because you have a Meeting Mind account.
    </div>
  </div>
</body>
</html>`;
}

// ── Send batch ────────────────────────────────────────────────────────────────

async function sendBatch(
  users: Profile[],
  template: "promo_1" | "promo_2" | "promo_3",
  buildHtml: (name: string | null) => string,
  subject: string
): Promise<void> {
  if (users.length === 0) {
    log(`No users for ${template}. Skipping.`);
    return;
  }

  log(
    `Sending ${template} to ${users.length} users${DRY_RUN ? " (DRY RUN)" : ""}…`
  );

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    if (!user.email) continue;

    if (DRY_RUN) {
      log(`[DRY RUN] Would send ${template} → ${user.email}`);
      sent++;
      continue;
    }

    try {
      await sendEmail({
        app: "meetingmind",
        to: user.email,
        subject,
        html: buildHtml(user.display_name),
      });
      await recordSend(user.id, user.email, template);
      sent++;
      log(`Sent ${template} → ${user.email}`);
    } catch (err: any) {
      failed++;
      log(`FAILED ${template} → ${user.email}: ${err?.message}`);
    }

    // ~2 req/s to stay within Resend rate limits
    await new Promise((r) => setTimeout(r, 600));
  }

  log(`${template} done. Sent: ${sent} | Failed: ${failed}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  requireEnv("RESEND_API_KEY");
  requireEnv("SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  log("=== Meeting Mind Email Drip Sequence ===");
  log(`Offer ID: ${OFFER_ID}`);
  log(`Dry run:  ${DRY_RUN}`);
  log(`Step:     ${ONLY_STEP ?? "all"}`);
  log("");

  // Ensure Play offer is active (skip if key file missing or SKIP_PLAY=true)
  if (!SKIP_PLAY && fs.existsSync(PLAY_KEY_FILE)) {
    await ensureOfferActive();
    log("");
  } else {
    log("Skipping Play offer setup (SKIP_PLAY=true or key file not found).");
  }

  // ── Touch 1: Welcome offer (new users, 24h+) ──────────────────────────────
  if (!ONLY_STEP || ONLY_STEP === 1) {
    log("--- Touch 1: Welcome offer ---");
    const t1 = await getTouch1Users();
    await sendBatch(
      t1,
      "promo_1",
      buildTouch1Html,
      `🎙️ Your exclusive Meeting Mind offer — 1 month FREE`
    );
    log("");
  }

  // ── Touch 2: Feature reminder (3+ days after promo_1) ────────────────────
  if (!ONLY_STEP || ONLY_STEP === 2) {
    log("--- Touch 2: Feature reminder ---");
    const t2 = await getTouch2Users();
    await sendBatch(
      t2,
      "promo_2",
      buildTouch2Html,
      `Still thinking about Meeting Mind Pro? Here's what you're missing`
    );
    log("");
  }

  // ── Touch 3: Last chance (7+ days after promo_2) ─────────────────────────
  if (!ONLY_STEP || ONLY_STEP === 3) {
    log("--- Touch 3: Last chance ---");
    const t3 = await getTouch3Users();
    await sendBatch(
      t3,
      "promo_3",
      buildTouch3Html,
      `⏰ Last chance — your Meeting Mind offer expires soon`
    );
    log("");
  }

  log("=== All done ===");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
