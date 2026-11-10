#!/usr/bin/env bash
# Health probe for the MeetingMind web app (Fly app meeting-mind-web). Read-only GETs.
# Usage: web-health.sh <base-url>        exit 0 = healthy, 1 = unhealthy
# Checks that "/" and "/auth" answer 200 with the app's own markup (not a Fly or Next error page).
set -euo pipefail

base="${1:?usage: web-health.sh <base-url>}"
base="${base%/}"
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

problems=0
check() {
  local path="$1" pattern="$2" code
  code="$(curl -sS -o "$body" -w '%{http_code}' --max-time 15 "$base$path" 2>/dev/null || true)"
  if [[ "$code" != "200" ]]; then
    echo "FAIL $path: HTTP ${code:-000}"
    problems=$((problems + 1))
  elif ! grep -Eiq "$pattern" "$body"; then
    echo "FAIL $path: HTTP 200 but expected markup missing"
    problems=$((problems + 1))
  else
    echo "ok   $path"
  fi
}

check "/" 'Meeting ?Mind'
check "/auth" 'Sign in|Create an account'

[[ "$problems" -eq 0 ]]
