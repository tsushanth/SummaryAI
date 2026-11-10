# Web deploy (GitHub Actions to Fly)

The MeetingMind web app (Fly app `meeting-mind-web`, source in `web/`) is deployed by
`.github/workflows/web-deploy.yml`.

## What triggers it

- A push to `main` that changes `web/**` or the workflow file itself.
- Manual run (Actions tab, "Web deploy (Fly)", Run workflow). It only runs on `main`.
- Only one deploy runs at a time; a running deploy is never cancelled.

## What it does

1. Runs the web tests (`npm --prefix web ci --ignore-scripts && npm --prefix web test`). A failure means no deploy.
2. Records the image of the newest complete Fly release (the rollback target). If it cannot be read, the job fails before deploying.
3. Deploys with `flyctl deploy web -a meeting-mind-web --remote-only` (build args come from `web/fly.toml`).
4. Watches `https://meeting-mind-web.fly.dev`: waits 90 s, then 5 checks 30 s apart. Each check needs `/` and `/auth` to answer 200 with the app's own markup. Two consecutive failed checks, or no passing check at all, count as unhealthy.
5. If anything fails after the deploy started, it redeploys the recorded image
   (`flyctl deploy -a meeting-mind-web --image <previous image>`), re-checks health, and leaves the job marked failed so GitHub emails the failure.

The Fly token is the repository secret `FLY_API_TOKEN` (an app-scoped deploy token for `meeting-mind-web`). It is only exposed to the steps that call Fly.

## Not covered

- The backend (`summary-ai-backend`) is not deployed by this workflow.
- Android, iOS and desktop builds are not covered.
- A rollback restores the previous image, not previous Fly config (`web/fly.toml`) or Fly secrets.
- The watch is about 4 minutes, not a long soak; a slow-burn regression after that is not caught.

## Roll back by hand

```bash
flyctl releases -a meeting-mind-web --image      # pick the last good release's image
flyctl deploy -a meeting-mind-web --image registry.fly.io/meeting-mind-web:deployment-XXXXXXXX
```

Then revert the offending commit on `main` (the revert redeploys through the workflow), otherwise the next web change redeploys the bad code.

## Token rotation

```bash
flyctl tokens create deploy -a meeting-mind-web --expiry 8760h 2>/dev/null | gh secret set FLY_API_TOKEN --repo tsushanth/SummaryAI
```

The token lasts one year. Never paste it anywhere else; secrets live only in GitHub Actions secrets.
