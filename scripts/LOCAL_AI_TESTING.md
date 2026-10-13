# Testing the AI features locally without an Anthropic API key

The backend calls the Anthropic Messages API (summaries, regenerate, follow-up email, cross-meeting chat, Q&A).
For local testing, `llm-cli-shim.mjs` answers those calls with your logged-in `claude` CLI (subscription, not the paid API key).
Tools are disabled and the CLI runs in an empty temp directory. Test use only.

```bash
# 1. adapter (port 9099)
node scripts/llm-cli-shim.mjs

# 2. backend (port 8080); the key is a dummy, the base URL points at the adapter
cd backend
ANTHROPIC_API_KEY=shim-local ANTHROPIC_BASE_URL=http://127.0.0.1:9099 \
DISABLE_BACKGROUND_LOOPS=1 NODE_ENV=development npx tsx src/index.ts
```

- `DISABLE_BACKGROUND_LOOPS=1` matters whenever `.env` points at the production database: without it the stuck-meeting,
  bot-reconciler and coaching-recovery loops start and act on real users' data.
- The reply wording comes from the CLI's model, so exact quality can differ from production.
- The Android app can reach the local backend with `adb reverse tcp:8080 tcp:8080` and a build whose `API_BASE_URL` is `http://localhost:8080`.
