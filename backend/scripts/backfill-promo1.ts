/**
 * Backfill script — mark already-emailed users as promo_1 sent
 *
 * Run this once after applying migration 002_email_sequences.sql.
 * It reads a CSV of emails (exported from Resend) and inserts rows
 * into user_emails so the drip sequence skips Touch 1 for them.
 *
 * Usage:
 *   export SUPABASE_URL=https://xxx.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   EMAILS_CSV=~/Downloads/resend-emails.csv npx tsx scripts/backfill-promo1.ts
 *
 * CSV format: any CSV with an "email" or "to" column (Resend export format).
 * Or set EMAILS_FILE to a plain text file with one email per line.
 */

import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function parseEmails(): string[] {
  const csvFile = process.env.EMAILS_CSV?.replace("~", process.env.HOME!);
  const txtFile = process.env.EMAILS_FILE?.replace("~", process.env.HOME!);

  if (!csvFile && !txtFile) {
    console.error("ERROR: Set EMAILS_CSV or EMAILS_FILE env var");
    process.exit(1);
  }

  if (txtFile) {
    return fs
      .readFileSync(txtFile, "utf8")
      .split("\n")
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
  }

  // Parse CSV — look for "email" or "to" column
  const content = fs.readFileSync(csvFile!, "utf8");
  const lines = content.split("\n");
  const headers = lines[0].toLowerCase().split(",").map((h) => h.trim().replace(/"/g, ""));
  const emailCol = headers.indexOf("email") !== -1 ? headers.indexOf("email") : headers.indexOf("to");

  if (emailCol === -1) {
    console.error("ERROR: CSV must have an 'email' or 'to' column");
    process.exit(1);
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(",");
      return cols[emailCol]?.trim().replace(/"/g, "").toLowerCase() ?? "";
    })
    .filter(Boolean);
}

async function main() {
  const emails = parseEmails();
  log(`Loaded ${emails.length} emails from file`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Look up profiles by email
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email")
    .in("email", emails);

  if (error) {
    console.error("Supabase error:", error);
    process.exit(1);
  }

  log(`Found ${profiles?.length ?? 0} matching profiles in Supabase`);

  if (!profiles || profiles.length === 0) {
    log("Nothing to backfill.");
    return;
  }

  // Insert into user_emails (skip existing)
  const rows = profiles.map((p: { id: string; email: string }) => ({
    user_id: p.id,
    email: p.email,
    template: "promo_1",
    sent_at: new Date().toISOString(),
    status: "sent",
  }));

  const { error: insertError } = await supabase
    .from("user_emails")
    .upsert(rows, { onConflict: "user_id,template", ignoreDuplicates: true });

  if (insertError) {
    console.error("Insert error:", insertError);
    process.exit(1);
  }

  log(`Backfilled ${rows.length} rows into user_emails (template=promo_1)`);
  log("These users will now receive Touch 2 after 3 days if still not subscribed.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
