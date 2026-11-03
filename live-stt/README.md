# mm-live-stt

Live transcription service for MeetingMind bot meetings. Recall.ai dials this service's websocket with raw mixed audio, the
service streams it to Soniox realtime (diarization + language id), maps speaker labels to participant names, and posts FINAL
segments to the backend. Status: skeleton, tested against a fake Soniox and (opt-in) the real API. Not deployed.

    Recall bot --wss audio_mixed_raw.data + participant_events.speech_on/off--> /ingest/<ref>/?token=<hmac>
        -> MeetingSession (replay buffer, reconnect, rollover, failover) -> Soniox realtime
        -> Segmenter -> SpeakerMapper -> DeliveryQueue -> HttpSink -> backend POST /internal/live-segments

## Commands

    npm install
    npm test                                  unit + integration + replay harness (fake Soniox, no network, no keys)
    npm run replay                            60 s two-voice replay with an injected disconnect, prints a report
    REAL_SONIOX=1 npm test -- test/replay.real.test.ts      opt-in real Soniox run (cents); needs SONIOX_API_KEY in the environment or SONIOX_ENV_FILE=<path to a local .env>; never printed
    npx tsx scripts/probe-real.ts english|multilang|keepalive|concurrency|header   real-API probes

## Configuration (environment only; no secrets in files)

| Variable | Meaning |
|---|---|
| `INGEST_TOKEN_SECRETS` | comma list of HMAC secrets for the per-bot URL token (new first, old during rotation) |
| `SONIOX_API_KEY` | the Soniox account is shared with other products (10 concurrent streams per org): keep `MAX_SONIOX_STREAMS` low |
| `MAX_SONIOX_STREAMS` (3), `MAX_SESSIONS` | caps; new meetings beyond the cap get HTTP 503 and an alert |
| `SINK` (`http`), `BACKEND_SINK_URL`, `BACKEND_SINK_SECRET` | default sink: HMAC-signed POST to the backend |
| `SINK=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | alternative direct insert (see PR for why it is not the default) |
| `SONIOX_AUTH_MODE` (`header`), `SONIOX_ENDPOINT_DETECTION` (1), `SONIOX_MODEL` (`stt-rt-v6`) | Soniox client |
| `ADMIN_TOKEN` | enables `GET /healthz?detail=1` (per-meeting metrics, hashed ids) |
| `ALERT_WEBHOOK_URL` | alert hook target (429 / stream cap / fatal / degraded / failover); throttled per kind |

Ingest URL for the Recall bot: `wss://<app>.fly.dev/ingest/<ref>/?token=<hex>` where `token = HMAC-SHA256(secret, ref)` and `ref`
is an id the backend mints before it creates the bot (the trailing slash before `?` is required by Recall).
