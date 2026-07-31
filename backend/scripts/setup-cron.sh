#!/usr/bin/env bash
# ============================================================
# Meeting Mind Email Drip — Hetzner Cron Setup
#
# Run this script on the Hetzner server once:
#   ssh -i ~/.ssh/google_compute_engine root@178.156.192.31
#   bash /tmp/setup-cron.sh
#
# What it does:
#   1. Writes /opt/meetingmind/run-drip.sh (the nightly job)
#   2. Installs a root cron entry: runs at 10:00 UTC daily
#   3. Logs to /var/log/meetingmind-drip.log
# ============================================================

set -e

# ── Config — fill these in before running ────────────────────
RESEND_API_KEY="${RESEND_API_KEY:?Set RESEND_API_KEY}"
SUPABASE_URL="${SUPABASE_URL:?Set SUPABASE_URL}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY}"
REPO_DIR="${REPO_DIR:-/opt/meetingmind}"
# ─────────────────────────────────────────────────────────────

mkdir -p "$REPO_DIR"

cat > "$REPO_DIR/run-drip.sh" <<EOF
#!/usr/bin/env bash
set -e
export RESEND_API_KEY="$RESEND_API_KEY"
export SUPABASE_URL="$SUPABASE_URL"
export SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
export SKIP_PLAY=true

cd "$REPO_DIR/backend"
echo "[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting drip run..."
npx tsx scripts/send-promo.ts >> /var/log/meetingmind-drip.log 2>&1
echo "[\$(date -u +%Y-%m-%dT%H:%M:%SZ)] Done."
EOF

chmod +x "$REPO_DIR/run-drip.sh"

# Install cron (runs at 10:00 UTC daily)
CRON_LINE="0 10 * * * /opt/meetingmind/run-drip.sh >> /var/log/meetingmind-drip.log 2>&1"
(crontab -l 2>/dev/null | grep -v meetingmind; echo "$CRON_LINE") | crontab -

echo "Cron installed. Run schedule: daily at 10:00 UTC"
echo "Logs: /var/log/meetingmind-drip.log"
echo "Test run: $REPO_DIR/run-drip.sh"
