# What is deployed

Newest first. Parity rule: what runs in production is on `main` (tree compared for the deployed paths). The live site meetingmind.org runs on Fly (`meeting-mind-web`); `web/deploy.sh` (Cloud Run) is not what serves it. Deploys are `fly deploy --remote-only` from a clean checkout of `origin/main`.

| Component | Fly app | Release | Image | Built from | Date |
|---|---|---|---|---|---|
| Backend (`backend/`, summary-ai-backend.fly.dev) | `summary-ai-backend` | v60 | `registry.fly.io/summary-ai-backend:deployment-01M85HVXGK26HWJGM331VTSH89` | `origin/main` at `ee5cb3e` (`backend/` tree `6ed54eb8a3e3a7d5677d3d487fabf6db38897d95` identical to main; backend change is #95) | 2026-11-24 (UTC) |
| Web (`web/`, meetingmind.org) | `meeting-mind-web` | v39 | `registry.fly.io/meeting-mind-web:deployment-01M80MVFF67NNXW4G3ZYX9MPSN` | `origin/main` at `8c20741` (squash merge of #91; `web/` tree `95ac59f1309ef4fe01c82d47ae720fe58b40373b` identical to main) | 2026-11-22 (UTC) |

## 2026-11-23 Android 1.7.13 (versionCode 66): Traditional Chinese and output language, staged 20%
- Play production: 1.7.13 (66) `inProgress` at userFraction 0.2; 1.7.12 (65) `completed`. Read back from the production track after commit. Release note (en-US): "Traditional Chinese for Taiwan and Hong Kong, and meeting titles and errors in your language."
- Tag `play/1.7.13-66` on main SHA `0c07db00ffe3ca6884d513a908b4cac8cb1ac346` (PR #98, squash; built tree identical to main). AAB sha256 `f5bd0ca39aed35de3667b5a33a2af63640c59295e398b803f71eefe3ea4ae32b`.
- Contents: Android side of #93 (explicit output language sent to the backend) and #95/#96 (zh-TW, zh-HK, `values-b+zh+Hant`). Backend for both is already live (v59, v60).
- Verified: `testDebugUnitTest` 282 tests, 0 failures; `bundleRelease` signed with the upload key (jarsigner verified); merged manifest versionCode 66 / versionName 1.7.13. Device (Pixel 9 Pro, side-by-side `.dbg` debug build of the same tree, uninstalled afterwards; owner install untouched): sign-in screen under per-app locales zh-TW (Traditional, TW wording), zh-HK (Traditional, HK wording), zh-CN (Simplified), es and en all correct, no FATAL/ANR. Not tested on device: signed release AAB itself (cannot install over the Play-signed app), screens past sign-in.
- Not promoted beyond 20%.

## 2026-11-23 Backend (summary-ai-backend): Traditional Chinese output language (#95), release v60
- Fly release v60 (previous v59, image `registry.fly.io/summary-ai-backend:deployment-01M855TND6ZZHSE10Y172EQNW2`, built from `63d6069`). Deployed with `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `ee5cb3e`; worktree `backend/` tree equals `origin/main:backend` (`6ed54eb8a3e3a7d5677d3d487fabf6db38897d95`).
- Delta proof (backend deploys were frozen for the Soniox rollout, so this was checked first): `git log 63d6069..origin/main -- backend/` is only `3031d38` (#95); `git diff 63d6069..origin/main --stat -- backend/` is `src/lib/outputLanguage.ts` and `test/output-language.test.ts`, nothing else. No Soniox, STT provider, feature-flag, migration, package.json, Dockerfile or env change shipped. #96 (zh-TW wording) is Android resources only. v59 confirmed as the newest release before this deploy.
- What it does: `output_language` zh-TW / zh-Hant => "Traditional Chinese (Taiwan)", zh-HK / zh-MO => "Traditional Chinese (Hong Kong)", bare zh / zh-CN / zh-Hans => "Simplified Chinese" (was "Chinese"). Own-key whitelist kept, so `constructor` / `__proto__` give no instruction.
- Verified: `tsc` clean, vitest 90 files / 1264 tests pass (`--maxWorkers=2`, on this worktree); no live meetings or user traffic in the logs before deploy (only health checks and background loops); after deploy `/health` 200, `/health/detailed` healthy with all five loops fresh; unauthenticated question call still 401 "Missing or invalid authorization header", same as before; deployed `/app/dist/lib/outputLanguage.js` contains the Taiwan and Hong Kong names (1 match each). NOT verified end to end: no authenticated call with `output_language` (no test user token); covered by unit tests only.
- Secrets: names only listed, none set or unset.
- Rollback: `flyctl releases rollback 59 -a summary-ai-backend` (or `flyctl deploy --image registry.fly.io/summary-ai-backend:deployment-01M855TND6ZZHSE10Y172EQNW2 -a summary-ai-backend`).

## 2026-11-23 Backend (summary-ai-backend): output language (#93), release v59
- Fly release v59 (previous v58, 2026-11-13 17:07 PT, image `registry.fly.io/summary-ai-backend:deployment-01M7AXYCHQHG60W6PQWEDK8565`). Deployed with `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `63d6069`.
- Delta proof: the compiled `dist/` of v58 (read over `flyctl ssh`) is file-for-file identical to a fresh `tsc` build of `a0826f2`, the last `backend/` commit before #93. `git log a0826f2..origin/main -- backend/` is only `63d6069` (#93): no Soniox, STT provider, feature-flag, migration, package.json, Dockerfile or env change shipped. The v59 `dist/` is identical to a build of main (`.map` files and the `llmUsage.js` copy step aside).
- What it does: Q&A, live insights and coaching append a language instruction when an explicit `output_language` is given (own-key lookup, so `constructor` or `__proto__` give no instruction); no language means unchanged prompts; `Errors.*` carry a stable `code`, `message` unchanged. Android (#93) sends `output_language` only for an explicit preference; `auto` or empty sends nothing.
- Verified: `tsc` clean, vitest 90 files / 1262 tests pass; `/health` 200 and `/health/detailed` healthy with all loops fresh; an unauthenticated question call still answers 401 "Missing or invalid authorization header", same as before. NOT verified end to end: no authenticated call with `output_language` `th` or `constructor` (no test user token); covered by unit tests only.
- Secrets: names only listed, none set or unset.
- Rollback: `flyctl releases rollback 58 -a summary-ai-backend` (or `flyctl deploy --image registry.fly.io/summary-ai-backend:deployment-01M7AXYCHQHG60W6PQWEDK8565 -a summary-ai-backend`). Old Android clients are unaffected either way.
- Android for #93 NOT released: Play production still has 1.7.12 (65) `inProgress` at 20%, so no new upload was staged (an upload would replace the in-progress release). Next release needs 65 promoted to 100% (or halted) first; the old backend accepted the new fields, and the app falls back safely.

## 2026-11-21 Web (meetingmind.org): Gaugemint website visits on /admin (#91), release v39
- GitHub Actions `Web deploy (Fly)` run 44980866740 for `8c20741` (squash merge of #91), success. Adds a server-rendered "Website visits (Gaugemint)" section to /admin (framed Gaugemint embed), shown only to admins and only when the Fly secret `GAUGEMINT_EMBED_URL` is set (set before the merge as a new secret: v38 was that secret change, copy in Keychain `GAUGEMINT_EMBED_URL_meetingmind.org`; Gaugemint site meetingmind.org has embed origins https://meetingmind.org and https://www.meetingmind.org). The URL is validated (`web/src/lib/gaugemintEmbed.ts`) and never reaches client JS (checked in the build output).
- Verified after deploy: anonymous `/admin` answers 307 and its HTML contains no embed address. NOT verified: the framed dashboard itself renders for the admin Google account (needs a login); check it once and note it here.
- Tests before merge: 170 pass, 0 fail, `tsc` and `next build` clean.

## 2026-11-21 Web (meetingmind.org, Fly `meeting-mind-web`): Gaugemint visit counter on the landing page (#89) + install-referrer tag (#83) finally live
- Release v37 via the GitHub Actions `Web deploy (Fly)` run for `86ee24f` (squash merge of #89), 5m14s, success. It shipped #83 (the Play-link install referrer `utm_source=meetingmind_web`) together with #89.
- CORRECTION of the 2026-11-17 entry below: #83 was NOT live from 2026-11-17. The CI run for `8c29316` (2026-11-18 00:19Z) timed out after 21 minutes in "Deploy to Fly" and rolled back, so v35 never served: v36 (2026-11-18 00:40Z) re-used the v34 image built from `ca5af80` on 2026-11-13. Until v37, production served the 2026-11-13 web tree.
- Verified live in a real browser: the landing page injects `<script data-domain="meetingmind.org" src="https://guagemint.com/js/script.js">` (absent from server HTML by design: next/script afterInteractive); `/privacy` and `/auth` load none (the share page and dashboard were checked before merge); the privacy page carries one sentence about Gaugemint; the Play links carry `referrer=utm_source%3Dmeetingmind_web...`. The site is registered in the Gaugemint ops account; the script honours Do Not Track and Global Privacy Control.

## 2026-11-20 Android 1.7.12 (versionCode 65): seven added UI languages, staged 20%
- Play production: 1.7.12 (65) `inProgress` at userFraction 0.2; 1.7.11 (64) remains `completed`. Read back from the production track after commit.
- Tag `play/1.7.12-65` on main SHA `5068f1dbdc1826895a60045ba6bdd357746e33c5` (PR #87, squash). AAB sha256 `0c582cb81ee210fb030c824c1966107e69fbc01eefdfd3930edb030921d5b0df`.
- Shipped: Czech, Greek, Finnish, Hungarian, Romanian, Swedish and Ukrainian UI (#81), the hard-coded-English-to-strings.xml sweep (#85, ~40 Kotlin files), locale-aware dates, a disabled `AppLocalesMetadataHolderService` manifest entry, and a hard-coded-string guard test. No permission, SDK, target or dependency changes vs `play/1.7.11-64`. Machine translations, owner-accepted.
- Verified: `testDebugUnitTest` 257 tests, 0 failures; `lintDebug` 0 errors; `bundleRelease` signed with the upload key (jarsigner verified); merged manifest versionCode 65 / versionName 1.7.12; Play edit validated before commit.
- NOT verified: no Play-signed install on a device, no manual check of the 7 new languages in the running app, no crash/ANR review yet, no check of the notification, auth-error and VoIP strings that moved into resources.
- Rollback: a completed release cannot be halted. Halt the staged 65 release while it is below 100%, or ship a higher versionCode built from `play/1.7.11-64`.
- Promotion to 100% needs 24-48h of crash/ANR review in Play Console vitals first. Not promoted.

## 2026-11-17 Web: install-referrer tag on the Play link (#83)
- `web/src/lib/playLinks.ts`: `referrer=utm_source=meetingmind_web&utm_medium=web&utm_campaign=<download|llms>`. Convention: growth-research/LINK-CONVENTION.md.
- Verified live: the Download section link and `llms.txt` carry the tag; tagged URL returns HTTP 200 on play.google.com.
