#!/usr/bin/env bash
# Integration check: the Android client's Supabase auth flow with the PUBLISHABLE key (sb_publishable_..., not a JWT).
#
# Runs against the REAL project and the real backend with a throwaway account:
#   1. sign up (REST /auth/v1/signup, apikey header only)
#   2. sign in twice: apikey only, and apikey + "Authorization: Bearer <publishable key>" (what supabase-kt 2.6.x sends)
#   3. call authenticated backend endpoints with the user's access token (read-only GETs)
#   4. refresh the token (both header styles) and check the new access token still works
#   5. DELETE /api/users/account (the app's Delete Account) and check the account can no longer sign in or refresh
#   6. print the user id so the caller can run read-only SQL counts proving the rows are gone
#
# The publishable key is public by design. The password is random per run and never printed.
#
# Usage: scripts/supabase-publishable-key-check.sh [email]
#   env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (default: read from android/app/build.gradle.kts),
#        API_BASE_URL (default https://summary-ai-backend.fly.dev), KEEP_ACCOUNT=1 to skip the delete step.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GRADLE="$ROOT/android/app/build.gradle.kts"
SUPABASE_URL="${SUPABASE_URL:-https://mlofjzlmncgnhxbiuemf.supabase.co}"
API_BASE_URL="${API_BASE_URL:-https://summary-ai-backend.fly.dev}"
KEY="${SUPABASE_PUBLISHABLE_KEY:-$(grep -oE 'sb_publishable_[A-Za-z0-9_-]+' "$GRADLE" | head -1)}"
EMAIL="${1:-puzzleverseai+mmpk$(date +%m%d%H%M)@gmail.com}"
PASSWORD="Pk-$(openssl rand -hex 12)"
PASS=0
FAIL=0

check() { # name, ok(0/1), detail
  if [ "$2" = "0" ]; then PASS=$((PASS + 1)); echo "PASS  $1 ${3:-}"; else FAIL=$((FAIL + 1)); echo "FAIL  $1 ${3:-}"; fi
}
jget() { python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    for k in sys.argv[1].split("."): d=d[k]
    print(d if d is not None else "")
except Exception:
    print("")' "$1"; }

case "$KEY" in sb_publishable_*) ;; *) echo "FAIL  key is not an sb_publishable_ key"; exit 2 ;; esac
echo "key kind: publishable (length ${#KEY}), JWT-shaped: $([[ "$KEY" == eyJ* ]] && echo yes || echo no)"
echo "account: $EMAIL"

req() { # outfile, curl args...  -> prints HTTP status
  local out="$1"; shift
  curl -sS -m 40 -o "$out" -w '%{http_code}' "$@"
}
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. sign up
S=$(req "$TMP/signup.json" -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID="$(jget user.id < "$TMP/signup.json")"
[ -z "$USER_ID" ] && USER_ID="$(jget id < "$TMP/signup.json")"  # auto-confirm returns {user:{id},session}; otherwise a bare user
check "signup (apikey only) -> 200 with user id" "$([ "$S" = 200 ] && [ -n "$USER_ID" ]; echo $?)" "[HTTP $S]"
[ -z "$USER_ID" ] && { echo "cannot continue without a user"; exit 1; }
echo "user id: $USER_ID"

# 2. sign in, both header styles
S=$(req "$TMP/si1.json" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
ACCESS="$(jget access_token < "$TMP/si1.json")"
check "sign-in (apikey only) -> 200 with access token" "$([ "$S" = 200 ] && [ -n "$ACCESS" ]; echo $?)" "[HTTP $S]"
check "access token is a JWT (3 parts) while the key is not" "$([[ "$ACCESS" == eyJ*.*.* ]]; echo $?)"

S=$(req "$TMP/si2.json" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
ACCESS2="$(jget access_token < "$TMP/si2.json")"
REFRESH="$(jget refresh_token < "$TMP/si2.json")"
check "sign-in (apikey + Bearer publishable, supabase-kt style) -> 200" "$([ "$S" = 200 ] && [ -n "$ACCESS2" ] && [ -n "$REFRESH" ]; echo $?)" "[HTTP $S]"

# 3. authenticated backend calls (read-only) with the user's JWT in Authorization
S=$(req "$TMP/sub.json" "$API_BASE_URL/api/subscriptions/status" -H "Authorization: Bearer $ACCESS2" -H 'Accept: application/json')
check "backend GET /api/subscriptions/status with user token -> 200" "$([ "$S" = 200 ]; echo $?)" "[HTTP $S]"
S=$(req "$TMP/me.json" "$API_BASE_URL/api/users/me" -H "Authorization: Bearer $ACCESS2" -H 'Accept: application/json')
ME_ID="$(jget user.id < "$TMP/me.json")"
check "backend GET /api/users/me returns this user" "$([ "$S" = 200 ] && [ "$ME_ID" = "$USER_ID" ]; echo $?)" "[HTTP $S]"
S=$(req "$TMP/nokey.json" "$API_BASE_URL/api/subscriptions/status" -H 'Accept: application/json')
check "backend rejects a request with no token -> 401" "$([ "$S" = 401 ]; echo $?)" "[HTTP $S]"
S=$(req "$TMP/pubasbearer.json" "$API_BASE_URL/api/subscriptions/status" -H "Authorization: Bearer $KEY" -H 'Accept: application/json')
check "backend rejects the publishable key used as a bearer -> 401" "$([ "$S" = 401 ]; echo $?)" "[HTTP $S]"

# 4. refresh
S=$(req "$TMP/rf1.json" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=refresh_token" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}")
ACCESS3="$(jget access_token < "$TMP/rf1.json")"
REFRESH3="$(jget refresh_token < "$TMP/rf1.json")"
check "refresh (apikey + Bearer publishable) -> 200 with new tokens" "$([ "$S" = 200 ] && [ -n "$ACCESS3" ] && [ -n "$REFRESH3" ]; echo $?)" "[HTTP $S]"
S=$(req "$TMP/rf2.json" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=refresh_token" -H "apikey: $KEY" \
  -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH3\"}")
ACCESS4="$(jget access_token < "$TMP/rf2.json")"
REFRESH4="$(jget refresh_token < "$TMP/rf2.json")"
check "refresh (apikey only) -> 200 with new tokens" "$([ "$S" = 200 ] && [ -n "$ACCESS4" ]; echo $?)" "[HTTP $S]"
S=$(req "$TMP/sub2.json" "$API_BASE_URL/api/subscriptions/status" -H "Authorization: Bearer $ACCESS4" -H 'Accept: application/json')
check "backend GET /api/subscriptions/status with refreshed token -> 200" "$([ "$S" = 200 ]; echo $?)" "[HTTP $S]"
S=$(req "$TMP/user.json" "$SUPABASE_URL/auth/v1/user" -H "apikey: $KEY" -H "Authorization: Bearer $ACCESS4")
check "auth /user with apikey + user JWT -> 200 (same user)" "$([ "$S" = 200 ] && [ "$(jget id < "$TMP/user.json")" = "$USER_ID" ]; echo $?)" "[HTTP $S]"

# 5. delete account via the app's endpoint
if [ "${KEEP_ACCOUNT:-0}" != "1" ]; then
  S=$(req "$TMP/del.json" -X DELETE "$API_BASE_URL/api/users/account" -H "Authorization: Bearer $ACCESS4" -H 'Accept: application/json')
  check "backend DELETE /api/users/account -> 200" "$([ "$S" = 200 ]; echo $?)" "[HTTP $S]"
  S=$(req "$TMP/si3.json" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  check "sign-in after delete is refused (400)" "$([ "$S" = 400 ]; echo $?)" "[HTTP $S]"
  S=$(req "$TMP/rf3.json" -X POST "$SUPABASE_URL/auth/v1/token?grant_type=refresh_token" -H "apikey: $KEY" \
    -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH4\"}")
  check "refresh after delete is refused (400)" "$([ "$S" = 400 ]; echo $?)" "[HTTP $S]"
  echo "NEXT: verify row counts for user id $USER_ID are zero (read-only SQL): auth.users, public.profiles, public.recordings, public.todos"
fi

echo "---- $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
