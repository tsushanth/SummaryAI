# What is deployed

Newest first. Parity rule: what runs in production is on `main` (tree compared for the deployed paths). The live site meetingmind.org runs on Fly (`meeting-mind-web`); `web/deploy.sh` (Cloud Run) is not what serves it. Deploys are `fly deploy --remote-only` from a clean checkout of `origin/main`.

| Component | Fly app | Release | Image | Built from | Date |
|---|---|---|---|---|---|
| Backend (`backend/`, summary-ai-backend.fly.dev) | `summary-ai-backend` | v68 | `registry.fly.io/summary-ai-backend:deployment-01M8CNWRWY6SKY6DXHXFQHHCKR` | `origin/main` at `464634a` (squash merge of #119; `backend/` tree `20d83562f174ed6a595e0dd4dfe52b2e401e1b58` identical to main) | 2026-11-26 (UTC) |
| Web (`web/`, meetingmind.org) | `meeting-mind-web` | v43 | `registry.fly.io/meeting-mind-web:deployment-01M8CNXBE7KE1AJAXTEMJHWPBE` | `origin/main` at `464634a` (#119, deployed by the web-deploy workflow; `web/` tree `eaca6a737c817ac6f6def0a61e7c0e477a68902b` identical to main) | 2026-11-26 (UTC) |

## 2026-11-26 Web sign-up fixes, step counts, first-recording report (#119): backend v68, web v43
- Backend: `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `464634a`. Web: `web-deploy.yml` on the merge (run 45885190510 succeeded, no rollback). No migration, no secret set or unset. Calendar settings untouched.
- Quiet moment checked: no open bot run, no unfinished recording touched in 20 minutes, no live segment in 15 minutes, no auto-join due within 45 minutes, no open coaching session.
- Web: `NEXT_PUBLIC_ACTIVATION_EVENTS=1` is now set in `web/fly.toml` (anonymous step counts into `activation_events`; not sent with Do Not Track or Global Privacy Control; off again by removing that line). Privacy page says so. `/auth?error=` shows a message; no hydration errors on a direct visit to `/recordings/new`; no `Infinity:NaN` in the player; `first_recording_started` only after the microphone opened.
- Backend: loop `FirstRecordingAlert` (every 5 minutes) reports flow `first_recording_failed` when a user's first recording fails or has no speech; clear test accounts are skipped. `/health/detailed` now lists eight loops.
- Verified live with throwaway example.com accounts (since deleted, with their 7 test step rows): email sign-up to summary on web (browser recording 47 s, and a file upload), Google button reaches Google's sign-in page, a silent recording showed "No speech detected", all seven step events were stored, and the loop logged "skipped a test account". Backend `tsc` clean, vitest 101 files / 1379 tests; web 198 tests.
- NOT verified: a report actually sent for a real user (needs a real first-time failure), Google sign-in past Google's page, password reset email.
- Rollback: backend `flyctl releases rollback 67 -a summary-ai-backend`; web `flyctl deploy -a meeting-mind-web --image registry.fly.io/meeting-mind-web:deployment-01M89WXC4EMVGBM9MQWT88T2NT` then revert #119 on main.

## 2026-11-26 Backend v67: Google Calendar redirect address corrected (config only)
- `GOOGLE_REDIRECT_URI` secret updated to `https://summary-ai-backend.fly.dev/api/calendar/callback/google` (owner request). It still pointed at the old Cloud Run host, which answers 404, so Google Calendar connections could not complete. The new address was added to the OAuth client first and Google accepted it. No code, image or migration change.
- Checked: /health 200, no startup config warning. Not verified: a real end-to-end calendar connection by a user.
- Rollback: set `GOOGLE_REDIRECT_URI` back to `https://summary-ai-backend-917362189743.us-central1.run.app/v1/api/calendar/callback/google` (a dead address, so only if the new one is rejected).

## 2026-11-26 Backend v66: live transcription fallback alert only for Soniox-primary runs (#115)
- Backend: `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `6d6ab89`; previous v65. Web not deployed. No secret set or unset, no migration.
- Change: `LIVE_STT_FALLBACK_MIGRATION_MISSING` is raised only for a Soniox-primary bot run. Shadow and Recall runs log a warning. Migration 030 is still NOT applied; apply it (runbook step 0 in `backend/LIVE_STT.md`) before any Soniox-primary traffic.
- Quiet moment checked: no open bot run or active meeting, no unfinished recording touched recently, no live segment in 15 minutes, no auto-join due within 45 minutes, no open coaching session.
- Verified: `tsc` clean, vitest 100 files / 1373 tests; `/health/detailed` healthy with all seven loops fresh; all 119 compiled `.js` files on the machine identical to a fresh build of the same tree. NOT verified: a live meeting after the deploy.
- Expected alert: `BAD_GOOGLE_REDIRECT_URI` at boot, until the configuration change in #110 is made.
- Rollback: `flyctl releases rollback 65 -a summary-ai-backend`.
- Android #116 (automatic retry of a failed recording upload) is merged and NOT released; it needs a release after 1.7.15 (68). `testDebugUnitTest` 304 tests, 0 failures; `lintDebug` 0 errors; no device run.

## 2026-11-25 Android 1.7.15 (68), Play production, staged 20% (replaces the 20% rollout of 67)
- Tag `play/1.7.15-68` = `main` at `44d946c` (#113, version bump only on top of `253aac4`). Built from exactly this commit in a clean detached worktree; the `paywallkit`, `ratingkit` and `crosspromokit` library modules come from their local checkouts, as before.
- Play read back after commit: production 1.7.15 (68) `inProgress` userFraction 0.2, 1.7.13 (66) `completed`; 1.7.14 (67) is no longer on the track. Beta, alpha and internal moved to 68 `completed` (they held 54, 54 and 60). Uploaded with the Play edit API.
- 67 before replacing it (read 2026-11-25, data up to 11-24): Play returned no crash or ANR rate rows and no crash or ANR issue for versionCode 67 or 66 in 28 days. That is an absence of data at this install base, not a measured clean rate. No review in the reviews API window.
- targetSdk 36 / minSdk 26, Play Billing 8.0.0, upload-key signature (`jarsigner -verify` ok), AAB sha256 `21965a7badaaa15e4a3a0a512425a2376d7c27e4a2421786da32cb518f378613`. No permission added compared with the Play-generated APK of 67.
- Release note (en-US): "The Phone tab has been removed. A recording in progress can no longer be uploaded or discarded by mistake, and a failed calendar connection now returns you to the app."
- Contents: the Android changes of #110, on top of 1.7.14 (67).
- Checks: `testDebugUnitTest` 293 tests, 0 failures; `lintDebug` 0 errors (471 warnings).
- NOT verified: any device run, the Play-signed build, a real calendar sign-in. Google calendar connect stays broken until the redirect configuration in #110 is changed.
- Rollback: halt the staged rollout; 1.7.13 (66) stays completed. Promotion to 100% needs 24-48 h of crash/ANR review first. Not promoted.

## 2026-11-25 Database: client write lockdown (Supabase `mlofjzlmncgnhxbiuemf`), migration 031
- Applied to production before this was committed, recorded as `031_client_write_lockdown`. No deploy, no data change, no secret change.
- New in production: signed-in users can no longer write `recordings`, `meetings` or `bot_runs` directly (owner reads unchanged). The apps and website write through the backend only.
- Parts 1 and 2 of the file record what production already had since 2026-11-03 (live transcript tables server-written; only harmless profile columns client-writable), so a database rebuilt from the repo matches.
- Verified with role checks in transactions that were rolled back (client writes refused; owner reads, own-profile update and service-role writes pass), `/health/detailed` healthy, site 200. NOT verified: a signed-in device session after the change.
- Reverse: `backend/supabase/rollbacks/031_client_write_lockdown_down.sql`.

## 2026-11-25 Silent feature failures and coaching credit fixes (#110): backend v65
- Backend: `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `7f7be54`; previous v64. Web not deployed (`web/` unchanged). Android not released.
- Change: the coaching debug credit grant route is removed; credit debit and refund are one per session and a session starts only on the caller's own recording; live insights read fenced model replies; calendar callback failures are reported, the first import after connecting works and runs once per connection; meetings whose bot run ended are closed; `AbandonedUploads` and `AccountPurgeRetry` are in the loop watchdog; invariant changes. No migration, no secret set or unset.
- Quiet moment checked: no open bot run, no recording pending, uploading or processing, none touched in 10 minutes, no bot job due within 30 minutes, no open coaching session.
- First reconciler pass closed exactly the 11 meetings left `bot_joining` since June, as listed by a read-only query before the deploy: 7 to `failed` (`STATUS_NEVER_REPORTED`), 4 to `completed`. No row deleted (51 meetings before and after); no recording, bot run or coaching credit row changed.
- Verified: `tsc` clean and vitest 100 files / 1371 tests pass on the merged tree; Android `testDebugUnitTest` 293 tests, 0 failures; `/health` and `/health/detailed` healthy with all seven loops fresh; all 119 compiled `.js` files on the machine identical to a fresh build of the same tree; the coaching router loaded from the running image has no `grant-debug` route. An unauthenticated POST to it answers 401 (router authentication runs before routing, as before), so a 404 with a signed-in user was NOT observed.
- Watched for 7 minutes after the deploy, including the first invariant pass at +5 minutes: no error line in the logs, and the failure reporter received only the expected alert.
- Expected alert: `BAD_GOOGLE_REDIRECT_URI` (sent once at boot). Google calendar connect stays broken until the OAuth client and `GOOGLE_REDIRECT_URI` are changed (see #110).
- NOT verified: a signed-in request, a real calendar sign-in, a live meeting or live insights in production, a coaching session, any device run.
- Android: the app changes in #110 (no upload or discard of the file being recorded, calendar error link returns to the app, calendar screen reloads on return, debug credit call removed) need a release after 1.7.14 (67).
- Rollback: `flyctl releases rollback 64 -a summary-ai-backend` brings the debug grant route back, so prefer fixing forward. Rolling back does not undo the 11 meeting rows.

## 2026-11-25 Phone calls switched off (#108): web v42, backend v64, Android 1.7.14 (67) staged 20%
- Change: the phone call feature is hidden behind flags that are off (`FEATURE_PHONE_CALLS` on the backend, `PHONE_CALLS_ENABLED` in `web/src/lib/features.ts`, `FeatureFlags.PHONE_CALLS` on Android). The code stays. The PR text describes what each surface answers.
- Web: `web-deploy.yml` on the merge (run 45667754614 succeeded, no rollback). Verified live: `/phone` and `/phone/settings` answer 307 to `/recordings`; `llms.txt` is identical to main; the landing page has no phone call claim.
- Backend: `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `3fca3c4`. Delta since the v63 build (`55b3d15`) in `backend/`: only #108. No secret set or unset; `FEATURE_PHONE_CALLS` is unset. Quiet moment checked: no scheduled bot job, no open bot run, no unfinished recording, no active coaching session.
- Backend verified: `/health/detailed` healthy with all loops fresh; an empty `POST /v1/webhooks/twilio/voip-outbound` answers the "no longer available" TwiML; unauthenticated `GET /v1/api/phone/calls` still 401; all 117 compiled `.js` files on the machine are identical to a fresh build of the same tree. The Recall webhook routes, their signature check and raw-body capture are unchanged in the diff; no Recall delivery was seen in the logs after the deploy, so that was not observed live. NOT verified: signed-in phone routes in production, a live Twilio call, a bot joining a meeting.
- Android: Play production 1.7.14 (67) `inProgress` at userFraction 0.2; 1.7.13 (66) `completed`. Read back from the production track after commit (edit `17507256417470950378`, made with the Play edit API; the fastlane lanes have no rollout setting). Tag `play/1.7.14-67` on `3fca3c4`. AAB sha256 `cb9789cdf680999dc547579f736b1e524a11589fef09be0d3f39864334004065`. Release note (en-US): "The Phone tab has been removed. A language chosen for the app before its first launch is now kept."
- Android contents since `play/1.7.13-66`: #108 (no Phone tab; `FOREGROUND_SERVICE_PHONE_CALL` and its declaration, `MANAGE_OWN_CALLS`, `READ_PHONE_STATE` and the optional telephony feature removed) and #100 (a per-app language set before the first launch is kept).
- Android verified: `testDebugUnitTest` 289 tests, 0 failures; `bundleRelease` signed (jarsigner verified); merged manifest 67 / 1.7.14 without the removed entries. Store listing text, images and subscriptions were not changed. NOT verified: any device run, a Play-signed install, completion of Google's review, crash or ANR data.
- Rollback: backend `flyctl releases rollback 63 -a summary-ai-backend`; web `flyctl deploy -a meeting-mind-web --image registry.fly.io/meeting-mind-web:deployment-01M89RKD12F4WA30JM7JNHP89V` then revert #108 on main; Android: halt the staged 67 release while it is below 100%. Promotion to 100% needs 24-48h of crash/ANR review first. Not promoted.

## 2026-11-25 Meeting bot failures (#106): backend v63, web v41
- Backend: `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `55b3d15`. Web: `web-deploy.yml` on the merge (run succeeded, no rollback).
- Change: the bot failure reason is saved and shown, Zoom links without a passcode are warned about, "Join now", started and failed meetings stay listed, bots that never recorded end as failed.
- Quiet moment checked: no bot job due within 30 minutes, no bot run in the last 6 hours, only a finished upload 17 minutes earlier.
- First reconciler pass marked exactly six old never-admitted bot runs (and their meetings and recordings) failed. No email or push lines in the log after the deploy.
- Verified: tests rerun before merge (backend 1305, web 189, typecheck clean); `/health/detailed` healthy with all loops fresh; site `/` and `/auth` 200. NOT verified: a real bot joining a meeting.
- Rollback: `flyctl releases rollback 62 -a summary-ai-backend`; web `flyctl deploy -a meeting-mind-web --image registry.fly.io/meeting-mind-web:deployment-01M88987MVYRCNZNWS4HQYYAZB`. Rolling back does not undo the six rows.

## 2026-11-25 Backend v62: configuration only
- Same image as v61. Set `OUTREACH_EVENT_SECRET`, `OUTREACH_EVENTS_URL` and `ACTIVATION_EVENTS_ENABLED=true`, so outreach attribution reporting from #101 is now on. Off switch: unset `OUTREACH_EVENTS_URL`.

## 2026-11-24 Web (meeting-mind-web): outreach UTM captured and posted with utm_content (#104), release v40
- v39 (image `registry.fly.io/meeting-mind-web:deployment-01M80MVFF67NNXW4G3ZYX9MPSN`) -> v40. Deployed by `.github/workflows/web-deploy.yml` on the merge of #104 (tests, rollback target recorded, 90 s settle plus 5 health checks; run succeeded, no rollback). The web app has no long-running jobs; the loops are in the backend.
- Finding: the web client never called `POST /api/activation/attribution` in production, because `trackSignupDone` needs `NEXT_PUBLIC_ACTIVATION_EVENTS=1` at build time and that is not set in `web/fly.toml`. So #104 adds an independent path: `src/lib/outreach.ts` keeps `utm_source/utm_campaign/utm_content` from an outreach landing URL (localStorage `outreach_first_touch`, first touch wins, 30 days, try/catch), and `OutreachAttributionSender` in the dashboard layout posts `{ utm_source, utm_campaign, utm_content, platform: 'web' }` once for an account created in the last 7 days, then forgets it (a failed post keeps it; an older account's touch is dropped unsent). Skipped when the browser sends Do Not Track or Global Privacy Control. `parseUtm` also keeps `utm_content` (outreach only, case kept) so the existing call carries it when the activation flag is turned on. No cookie, no third-party script, no anon id or referrer on this path.
- Tests before merge: `npm test` 179 pass, 0 fail; `tsc` clean; `next build` clean with the fly.toml public build args. Also fixed the stale `navTabsLanguage` test (language map moved to `backend/src/lib/outputLanguage.ts`).
- Verified live (headless Chromium, no sign-in, no account): meetingmind.org and meeting-mind-web.fly.dev `/` and `/auth` 200; with `?utm_source=outreach&utm_campaign=selftest&utm_content=x` localStorage `outreach_first_touch` holds exactly those three fields plus a timestamp; without the params nothing is stored; no cookies, no console errors. NOT verified: the post after a real sign-up (would create an account); covered by unit tests of the body and the 7-day guard. Backend reports nothing until `OUTREACH_EVENTS_URL` and the secret are set (docs/OUTREACH-ATTRIBUTION.md), and nothing is stored here until `ACTIVATION_EVENTS_ENABLED=true`.
- Rollback: `flyctl deploy -a meeting-mind-web --image registry.fly.io/meeting-mind-web:deployment-01M80MVFF67NNXW4G3ZYX9MPSN` (see docs/web-deploy.md), then revert #104 on main.

## 2026-11-24 Backend (summary-ai-backend): outreach attribution reporting (#101), release v61, flag OFF
- Fly release v61 (previous v60, image `registry.fly.io/summary-ai-backend:deployment-01M85HVXGK26HWJGM331VTSH89`). `flyctl deploy --remote-only` from a clean detached worktree of `origin/main` at `e588eb3`; worktree `backend/` tree equals `origin/main:backend` (`d8e7f30620e3884f806dc2043db378b1c2affd7e`). Delta from the v60 build (`ee5cb3e`): only #101.
- What it does: signup (from `POST /api/activation/attribution` for utm_source=outreach) and activated (first completed recording) events to the Calldesk outreach metrics layer. Does nothing unless `OUTREACH_EVENTS_URL` and an event secret are set; neither is set, no secret was touched. See `docs/OUTREACH-ATTRIBUTION.md` for the enable steps and `docs/outreach-baseline.sql` for the 14-day baseline query.
- Quiet moment checked first: no user traffic in the logs, only health checks and the background loops. Verified after deploy: `/health/detailed` healthy with all loops fresh, `POST /api/activation/attribution` without a token still 204 (ACTIVATION_EVENTS_ENABLED is not set in production, so attribution is not stored yet). vitest 91 files / 1281 tests pass, tsc clean.
- Rollback: `flyctl releases rollback 60 -a summary-ai-backend`.

## 2026-11-23 Android 1.7.13 (versionCode 66): Traditional Chinese and output language, staged 20%
- Play production at release time: 1.7.13 (66) `inProgress` at userFraction 0.2; 1.7.12 (65) `completed`. Read back from the production track after commit. Later raised to 100%: read as `completed` on 2026-11-25 (see the 1.7.14 entry above). Release note (en-US): "Traditional Chinese for Taiwan and Hong Kong, and meeting titles and errors in your language."
- Tag `play/1.7.13-66` on main SHA `0c07db00ffe3ca6884d513a908b4cac8cb1ac346` (PR #98, squash; built tree identical to main). AAB sha256 `f5bd0ca39aed35de3667b5a33a2af63640c59295e398b803f71eefe3ea4ae32b`.
- Contents: Android side of #93 (explicit output language sent to the backend) and #95/#96 (zh-TW, zh-HK, `values-b+zh+Hant`). Backend for both is already live (v59, v60).
- Verified: `testDebugUnitTest` 282 tests, 0 failures; `bundleRelease` signed with the upload key (jarsigner verified); merged manifest versionCode 66 / versionName 1.7.13. Device (Pixel 9 Pro, side-by-side `.dbg` debug build of the same tree, uninstalled afterwards; owner install untouched): sign-in screen under per-app locales zh-TW (Traditional, TW wording), zh-HK (Traditional, HK wording), zh-CN (Simplified), es and en all correct, no FATAL/ANR. Not tested on device: signed release AAB itself (cannot install over the Play-signed app), screens past sign-in.
- Was at 20% when this entry was written; since raised to 100% (see the first bullet).

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
