# What is deployed

Newest first. Parity rule: what runs in production is on `main` (tree compared for the deployed paths). The live site meetingmind.org runs on Fly (`meeting-mind-web`); `web/deploy.sh` (Cloud Run) is not what serves it. Deploys are `fly deploy --remote-only` from a clean checkout of `origin/main`.

| Component | Fly app | Release | Image | Built from | Date |
|---|---|---|---|---|---|
| Web (`web/`, meetingmind.org) | `meeting-mind-web` | v35 | `registry.fly.io/meeting-mind-web:deployment-01M7P0BYF9JX282T9G6Y14EEBV` | `origin/main` at `8c29316` (merge of #83; `web/` tree identical to main) | 2026-11-18 (UTC) |

## 2026-11-17 Web: install-referrer tag on the Play link (#83)
- `web/src/lib/playLinks.ts`: `referrer=utm_source=meetingmind_web&utm_medium=web&utm_campaign=<download|llms>`. Convention: growth-research/LINK-CONVENTION.md.
- Verified live: the Download section link and `llms.txt` carry the tag; tagged URL returns HTTP 200 on play.google.com.
