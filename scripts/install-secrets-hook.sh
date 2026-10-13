#!/usr/bin/env bash
# Installs the global pre-push secrets-scan hook for this machine.
# Run once per machine. Idempotent — safe to re-run.

set -euo pipefail

HOOKS_DIR="$HOME/.git-hooks"
HOOK_PATH="$HOOKS_DIR/pre-push"

mkdir -p "$HOOKS_DIR"

cat > "$HOOK_PATH" <<'HOOK_EOF'
#!/usr/bin/env bash
# Global pre-push hook — blocks pushing secrets.
# Active for every repo (via `git config --global core.hooksPath`).
# Bypass for a one-off: SKIP_SECRETS_SCAN=1 git push   (use sparingly)

set -u

if [[ "${SKIP_SECRETS_SCAN:-0}" == "1" ]]; then
  echo "[pre-push] SKIP_SECRETS_SCAN=1 set — bypassing secrets scan." >&2
  exit 0
fi

RED=$'\033[0;31m'; YEL=$'\033[0;33m'; GRN=$'\033[0;32m'; NC=$'\033[0m'

remote="$1"
url="$2"
zero=$(git hash-object --stdin </dev/null | tr '0-9a-f' '0')

# Collect commit ranges being pushed (read from stdin per git pre-push protocol)
ranges=()
new_files=()
has_anything=0
while read -r local_ref local_sha remote_ref remote_sha; do
  [[ -z "$local_sha" ]] && continue
  if [[ "$local_sha" == "$zero" ]]; then
    continue  # delete, nothing to scan
  fi
  has_anything=1
  if [[ "$remote_sha" == "$zero" ]]; then
    # New branch — scan commits not yet on any remote branch
    range=$(git rev-list "$local_sha" --not --remotes 2>/dev/null | tr '\n' ' ')
    [[ -n "$range" ]] && ranges+=("$range")
  else
    ranges+=("$remote_sha..$local_sha")
  fi
done

if [[ "$has_anything" == "0" ]]; then
  exit 0
fi

# 1) Run gitleaks against pushed commits if available
if command -v gitleaks >/dev/null 2>&1; then
  for r in ${ranges[@]+"${ranges[@]}"}; do
    [[ -z "$r" ]] && continue
    # gitleaks accepts --log-opts; pass each range
    if ! gitleaks git --log-opts="$r" --redact --no-banner --exit-code 1 >&2; then
      echo "" >&2
      echo "${RED}❌ pre-push BLOCKED: gitleaks found secrets in the commits you're trying to push.${NC}" >&2
      echo "   Remote: $remote  ($url)" >&2
      echo "   Fix the offending commits (git rebase -i / git filter-repo) BEFORE pushing." >&2
      echo "   If this is a confirmed false positive, bypass with: SKIP_SECRETS_SCAN=1 git push" >&2
      exit 1
    fi
  done
fi

# 2) Regex fallback / belt-and-suspenders — scans the actual diff being pushed
PATTERNS='(sk-ant-api03-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|rk_live_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]+|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|xox[abprs]-[0-9A-Za-z-]{10,}|GOCSPX-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|SUPABASE_SERVICE_ROLE_KEY\s*[:=]|ANTHROPIC_API_KEY\s*[:=]\s*['"'"'"][^'"'"'"]+['"'"'"]|OPENAI_API_KEY\s*[:=]\s*['"'"'"][^'"'"'"]+['"'"'"]|RETELL_API_KEY\s*[:=]\s*['"'"'"][^'"'"'"]+['"'"'"])'

SENSITIVE_FILE_RE='\.env(\.|$)|service[-_]account.*\.json$|credentials.*\.json$|AuthKey_[A-Z0-9]+\.p8$|\.p12$|\.pem$|\.jks$|\.keystore$|\.pfx$|\.fly-secrets|(^|/)AndroidAppKey$'

FAIL=0
for r in ${ranges[@]+"${ranges[@]}"}; do
  [[ -z "$r" ]] && continue
  # Only scan ADDED lines (^+ excluding ^+++ file headers). Deletions can't introduce a secret.
  diff_added=$(git diff --unified=0 $r 2>/dev/null | awk '/^\+\+\+/ {next} /^\+/')
  hits=$(printf '%s\n' "$diff_added" | grep -nE "$PATTERNS" || true)
  if [[ -n "$hits" ]]; then
    echo "${RED}❌ pre-push BLOCKED: high-risk secret patterns detected in diff${NC}" >&2
    echo "$hits" | sed 's/^/    /' >&2
    FAIL=1
  fi
  # newly-added sensitive filenames
  new_sensitive=$(git diff --name-only --diff-filter=A $r 2>/dev/null | grep -iE "$SENSITIVE_FILE_RE" || true)
  if [[ -n "$new_sensitive" ]]; then
    echo "${RED}❌ pre-push BLOCKED: sensitive filename being added${NC}" >&2
    echo "$new_sensitive" | sed 's/^/    /' >&2
    FAIL=1
  fi
done


# 3) Credentials: signing passwords written into build files, and any secret value stored in your own local
#    credential files, must never be pushed. (A shared keystore password was once committed to ~10 public repos.)
KNOWN=$(mktemp)
trap 'rm -f "$KNOWN"' EXIT
# Values of PASSWORD/SECRET/TOKEN/PASSPHRASE entries in ~/.gradle/gradle.properties (8+ chars), plus one value per
# line from ~/.git-hooks/known-secrets.txt (add any secret you reuse somewhere, to keep it out of every repo).
if [[ -f "$HOME/.gradle/gradle.properties" ]]; then
  awk -F= 'BEGIN{IGNORECASE=1} $1 ~ /(PASSWORD|SECRET|TOKEN|PASSPHRASE)/ && length(substr($0,index($0,"=")+1))>=8 {print substr($0,index($0,"=")+1)}' "$HOME/.gradle/gradle.properties" >> "$KNOWN"
fi
if [[ -f "$HOME/.git-hooks/known-secrets.txt" ]]; then
  grep -vE '^\s*(#|$)' "$HOME/.git-hooks/known-secrets.txt" | awk 'length($0)>=8' >> "$KNOWN"
fi
# A literal after storePassword/keyPassword (quoted, in .gradle/.kts, or unquoted in .properties). Values read from
# properties, env vars or variables (providers.gradleProperty(...), System.getenv(...), $x) do not match.
SIGN_QUOTED='(store|key|keystore)_?pass(word|phrase)?[[:space:]]*[=:]?[[:space:]]*["'"'"'][^"'"'"'$[:space:]][^"'"'"'$]*["'"'"']'
SIGN_PROPS='^[^#]*(store|key|keystore)[_.-]?pass(word|phrase)?[[:space:]]*=[[:space:]]*[^[:space:]$"'"'"'#]'
for r in ${ranges[@]+"${ranges[@]}"}; do
  [[ -z "$r" ]] && continue
  added_by_file=$(git diff --unified=0 $r 2>/dev/null | awk '/^\+\+\+ b\// {f=substr($0,7); next} /^\+\+\+/ {next} /^\+/ {print f "\t" substr($0,2)}')
  [[ -z "$added_by_file" ]] && continue
  sign_files=$( { printf '%s\n' "$added_by_file" | awk -F'\t' '$1 ~ /\.(gradle|kts)$/' | grep -iE "$SIGN_QUOTED" ; \
                  printf '%s\n' "$added_by_file" | awk -F'\t' '$1 ~ /\.properties$/' | grep -iE "$SIGN_PROPS" ; } | cut -f1 | sort -u || true)
  if [[ -n "$sign_files" ]]; then
    echo "${RED}❌ pre-push BLOCKED: a signing password is written into a build file${NC}" >&2
    echo "$sign_files" | sed 's/^/    /' >&2
    echo "   Keep it out of git: put it in ~/.gradle/gradle.properties and read it with providers.gradleProperty(\"...\")." >&2
    FAIL=1
  fi
  if [[ -s "$KNOWN" ]]; then
    known_files=$(printf '%s\n' "$added_by_file" | awk -F'\t' '{print $2 "\t" $1}' | grep -F -f "$KNOWN" | awk -F'\t' '{print $NF}' | sort -u || true)
    if [[ -n "$known_files" ]]; then
      echo "${RED}❌ pre-push BLOCKED: a secret from your local credential files is in the changes you are pushing${NC}" >&2
      echo "$known_files" | sed 's/^/    /' >&2
      FAIL=1
    fi
  fi
done

if [[ "$FAIL" == "1" ]]; then
  echo "" >&2
  echo "${YEL}If this is a confirmed false positive, bypass with:${NC} SKIP_SECRETS_SCAN=1 git push" >&2
  exit 1
fi

echo "${GRN}[pre-push] secrets scan passed ($remote)${NC}" >&2
exit 0
HOOK_EOF

chmod +x "$HOOK_PATH"
git config --global core.hooksPath "$HOOKS_DIR"

echo ""
echo "✓ Pre-push secrets-scan hook installed at: $HOOK_PATH"
echo "✓ Git core.hooksPath set globally to: $HOOKS_DIR"
echo ""
echo "The hook now runs on every \`git push\` from every repo on this machine."
echo "Best-effort uses \`gitleaks\` if installed (\`brew install gitleaks\`); always falls back to regex."
echo ""
echo "To bypass for a confirmed false positive: SKIP_SECRETS_SCAN=1 git push"
