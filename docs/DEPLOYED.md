# What is deployed

Newest first. Parity rule: what runs in production is on `main` (tree compared for the deployed paths). The live site meetingmind.org runs on Fly (`meeting-mind-web`); `web/deploy.sh` (Cloud Run) is not what serves it. Deploys are `fly deploy --remote-only` from a clean checkout of `origin/main`.

| Component | Fly app | Release | Image | Built from | Date |
|---|---|---|---|---|---|
| Web (`web/`, meetingmind.org) | `meeting-mind-web` | v35 | `registry.fly.io/meeting-mind-web:deployment-01M7P0BYF9JX282T9G6Y14EEBV` | `origin/main` at `8c29316` (merge of #83; `web/` tree identical to main) | 2026-11-18 (UTC) |

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
