#!/usr/bin/env bash
# Local, CI-free secrets guard for MeetingMind. Uses ./.gitleaks.toml. Requires gitleaks.
#
#   scripts/secrets-check.sh staged     scan what is about to be committed (default)
#   scripts/secrets-check.sh tree       scan the current working tree (no history)
#   scripts/secrets-check.sh history    scan full git history (known historical findings will show)
#   scripts/secrets-check.sh push       scan commits not yet on any remote (pre-push)
#   scripts/secrets-check.sh install    install a local pre-commit + pre-push hook for this clone
#
# Never prints secret values (--redact). Bypass only in an emergency: SKIP_SECRETS_SCAN=1.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
MODE="${1:-staged}"

if [[ "${SKIP_SECRETS_SCAN:-0}" == "1" ]]; then
  echo "[secrets-check] SKIP_SECRETS_SCAN=1, skipping." >&2
  exit 0
fi
if ! command -v gitleaks >/dev/null 2>&1; then
  echo "[secrets-check] gitleaks not installed (brew install gitleaks). Failing closed." >&2
  exit 2
fi

COMMON=(--config "$ROOT/.gitleaks.toml" --redact --no-banner --exit-code 1)

case "$MODE" in
  staged)  gitleaks git --staged "${COMMON[@]}" ;;
  tree)    gitleaks dir . "${COMMON[@]}" ;;
  history) gitleaks git "${COMMON[@]}" ;;
  push)
    range="$(git rev-list HEAD --not --remotes 2>/dev/null | tr '\n' ' ')"
    if [[ -z "${range// /}" ]]; then echo "[secrets-check] nothing unpushed."; exit 0; fi
    gitleaks git --log-opts="HEAD --not --remotes" "${COMMON[@]}"
    ;;
  install)
    hooks="$(git rev-parse --git-common-dir)/hooks"
    mkdir -p "$hooks"
    for h in pre-commit:staged pre-push:push; do
      name="${h%%:*}"; arg="${h##*:}"
      if [[ -e "$hooks/$name" ]] && ! grep -q "secrets-check.sh" "$hooks/$name"; then
        echo "[secrets-check] $hooks/$name exists and is not ours; not overwriting." >&2; continue
      fi
      printf '#!/usr/bin/env bash\nexec "$(git rev-parse --show-toplevel)/scripts/secrets-check.sh" %s\n' "$arg" > "$hooks/$name"
      chmod +x "$hooks/$name"; echo "installed $hooks/$name"
    done
    ;;
  *) echo "usage: $0 {staged|tree|history|push|install}" >&2; exit 64 ;;
esac
