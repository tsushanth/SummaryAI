# Security notes

## Incident 2026-11-03: legacy Supabase `service_role` JWT committed to this public repo

**Status: OPEN. The leaked key is still valid. Rotation is owner-only (Supabase dashboard).**

| Item | Detail |
|---|---|
| Exposed | Supabase project `mlofjzlmncgnhxbiuemf`: legacy `service_role` JWT (iat 2026-01-01, exp 2036), plus a Deepgram and an OpenAI key, in `backend/.env.example` |
| Commit | `b4fde0d` (2026-01-02 CST / 2026-01-03 UTC), reachable from every branch of `tsushanth/SummaryAI` (public) |
| Impact if abused | A service-role key bypasses RLS: full read/write of the database and storage |
| Evidence of abuse | None found. Edge logs for the last ~3 days show legacy-key REST/storage traffic only from the owner's own network and known infrastructure. Logs cannot show older activity and cannot tell `anon` from `service_role`. |
| Deepgram / OpenAI keys | Both return 401 on 2026-11-03 (already revoked or replaced). Revoking again in their dashboards is still harmless. |
| Live backend | Already runs a new-style `sb_secret_` key for the service role. It still runs the legacy anon JWT (used for `auth.getUser`). |

### Rotation checklist (do in this order; details in the runbook kept by the owner)

- [ ] Switch every server and tool from the legacy `service_role` JWT to an `sb_secret_` key (backend: done; Edge Function `play-rtdn`, local tools and `paywall-optimizer` Fly secret: pending)
- [ ] Switch the backend `SUPABASE_ANON_KEY` and the web build arg to the `sb_publishable_` key; redeploy web
- [ ] Ship an Android build that embeds `sb_publishable_` (all builds up to 1.7.4 embed the legacy anon JWT)
- [ ] Dashboard: Settings > JWT Keys > migrate to signing keys and rotate (no downtime)
- [ ] Dashboard: Settings > API Keys > disable legacy `anon` and `service_role` keys (reversible)
- [ ] Dashboard: Settings > JWT Keys > revoke the legacy JWT secret (this is what permanently kills the leaked key)
- [ ] Verify the leaked key now returns 401, then record the date here

### What this change does and does not do

- It removes secret-like values from the **current tree** where they are not public by design
  (`backend/.env.example` is placeholders only; `web/deploy.sh` and `web/cloudbuild.yaml` take the
  client key from the environment instead of a hard-coded value).
- It does **not** remove the key from git history. The key stays exposed until it is revoked in Supabase.
  History is not rewritten (no force-push).
- Still in the tree on purpose, because the apps need them at build time: the legacy anon JWT in
  `web/fly.toml`, `android/app/build.gradle.kts` and `ios/SummaryAI/Sources/Services/Auth/AuthService.swift`
  (public by design, but it stops working when legacy keys are disabled, so replace it with the
  `sb_publishable_` key in the same change that ships the new clients), and the Firebase client config.
- `web/src/components/WebFailureReporter.tsx` embeds an `afr_` report-ingest key in the browser bundle.
  It is shipped to every visitor, so it is not confidential, but it lets anyone post fake failure reports.
  Gitleaks still flags it on a full-tree scan; rotate it server-side if report spam appears.

## Guard against new leaks (no CI)

- `.gitleaks.toml` extends the default rules, adds rules for `sb_secret_` keys and legacy `service_role`
  JWTs, and allow-lists only (a) this project's anon JWT (pinned by its payload) and (b) the Firebase
  client config files.
- `scripts/secrets-check.sh` wraps gitleaks: `staged` (pre-commit), `push` (pre-push), `tree`, `history`.
  Run `scripts/secrets-check.sh install` once per clone to install local hooks (never overwrites an
  existing hook that is not ours).
- The global pre-push hook from `scripts/install-secrets-hook.sh` also picks up `.gitleaks.toml` automatically.
- `scripts/secrets-check.sh history` will keep reporting the 2026-01 commits until the history problem is
  closed by revoking the key; that is expected.
