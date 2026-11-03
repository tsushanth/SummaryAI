# Live transcription providers (Recall built-in vs Soniox via live-stt)

Everything here is OFF by default. With no new env vars set, the backend behaves exactly as before (a regression test pins the
create-bot request body byte for byte). The separate `live-stt/` service is PR #34.

## Env vars (backend app `summary-ai-backend`)

| Variable | Default | Meaning |
|---|---|---|
| `LIVE_STT_PROVIDER` | `recall` | `recall` = Recall's own transcript (today). `soniox` = no Recall transcript block; Recall streams mixed raw audio to the live-stt service. Any other value is treated as `recall`. |
| `LIVE_STT_SHADOW` | unset | Exactly `true` = keep Recall's transcript as the source of truth AND stream audio to live-stt; its segments are stored with `shadow=true` and ignored by every reader. Ignored when `LIVE_STT_PROVIDER=soniox`. |
| `LIVE_STT_WS_URL` | unset | Public base URL of the live-stt app, e.g. `wss://mm-live-stt.fly.dev` (no path; must be `wss://` in production). |
| `LIVE_STT_INGEST_SECRET` | unset | HMAC secret for the per-bot URL token. Equals the service's `INGEST_TOKEN_SECRETS` (current secret first). |
| `LIVE_STT_SHARED_SECRET` | unset | HMAC secret for `POST /internal/live-segments`. Equals the service's `BACKEND_SINK_SECRET`. Comma separated list accepted (rotation). Unset = the route answers 404. |
| `LIVE_STT_RATE_LIMIT_PER_MIN` | 1200 | Per source IP, before the signature check. |
| `LIVE_STT_REF_RATE_LIMIT_PER_MIN` | 240 | Per meeting ref, after the signature check (429 + `Retry-After`; the service retries). |

If `soniox` or shadow is requested but `LIVE_STT_WS_URL` or `LIVE_STT_INGEST_SECRET` is missing or invalid, `createBot` logs an
error, raises a throttled `LIVE_STT_MISCONFIGURED` alert and creates the bot with Recall's transcript (never a bot with no transcript).
Use separate values for the two secrets.

## What changes

- `createBot` (`src/services/recallService.ts`, `src/lib/liveStt.ts`): mints `ref` (uuid) before the Recall call; the audio URL is
  `<LIVE_STT_WS_URL>/ingest/<ref>/?token=<hex HMAC-SHA256(LIVE_STT_INGEST_SECRET, ref)>` (the `/` before `?` is required by Recall).
  The three bot_runs inserts in `routes/meetings.ts` add `live_stt_ref` and `live_stt_provider` only when the path is not `recall`
  (so default inserts are unchanged and work before the migration).
- Recall fields used (docs fetched 2026-11-03: how-to-get-mixed-audio-real-time, real-time-websocket-endpoints):
  `recording_config.audio_mixed_raw: {}` and
  `recording_config.realtime_endpoints[] = { type: "websocket", url, events: ["audio_mixed_raw.data", "participant_events.speech_on", "participant_events.speech_off"] }`.
  `soniox`: no `recording_config.transcript`, no transcript webhook endpoint. Shadow: transcript block and webhook endpoint as today, plus the above.
- `POST /internal/live-segments` (`src/routes/liveSegments.ts`): body is parsed raw (512 KB cap, 413), signature
  `x-mm-signature = v1=hex(HMAC-SHA256(secret, "<x-mm-timestamp>.<raw body>"))`, timestamp within 5 minutes, constant-time compare.
  Strict schema, up to 100 segments, finals only. Looks the bot run up by `live_stt_ref`. Upserts `live_transcripts` rows (same
  columns `webhooks.ts` writes) with `source_key = live:<ref>:<key>` (`shadow:<ref>:<key>` for shadow runs) and
  `ON CONFLICT (source_key) DO NOTHING`, so retries and replays never duplicate. Calls `queueInsightGeneration` once per request when
  at least one new row was stored (never for shadow). Responses: 200, 400, 401, 404 (disabled or unknown ref, the service drops the
  batch), 413, 429, 500. Bodies, text, names, secrets and signatures are never logged.
- Readers: every select on `live_transcripts` now adds `.eq('shadow', false)` (live-transcript GET, live insights, coaching, Q&A,
  stitcher). `test/live-stt-readers.test.ts` fails if a new reader is added without it.
- Finalisation is unchanged: the end-of-meeting path (`bot.call_ended`, `recording.done`, `finalizeBotRecording`, Deepgram pass) does
  not read the live provider. `stuckMeetingRecovery` stitches `live_transcripts` for either provider; for `soniox` runs the stitched
  transcript row is labelled `soniox_realtime` / `soniox_streaming` (still `language: 'en'`, a pre-existing hard-code).
- Language: Recall's low-latency mode forces English. With `soniox` the live path is language-auto (per-token language id in the
  service); the stitched fallback row still says `en`.

## Rollout (nothing below has been done)

1. Apply `supabase/migrations/026_live_stt.sql` to the MeetingMind Supabase project FIRST. The new reader filters select on
   `shadow`; deploying the code before the migration makes live transcripts, insights and Q&A fall back to empty.
2. Choose two random secrets. Set on `summary-ai-backend`: `LIVE_STT_SHARED_SECRET`, `LIVE_STT_INGEST_SECRET` (new secrets only,
   never overwrite existing ones). Deploy the backend (no behaviour change yet).
3. Deploy the `mm-live-stt` app (PR #34) with `INGEST_TOKEN_SECRETS` = ingest secret, `BACKEND_SINK_SECRET` = shared secret,
   `BACKEND_SINK_URL` = `https://summary-ai-backend.fly.dev/internal/live-segments`, `SONIOX_API_KEY`.
4. Shadow first: set `LIVE_STT_WS_URL` and `LIVE_STT_SHADOW=true`. Run one real meeting. Compare `live_transcripts` rows with
   `shadow = true` against `shadow = false` for that `meeting_id`; users see no change.
5. Switch: set `LIVE_STT_PROVIDER=soniox` (applies to the next bot; a running bot keeps its config). Unset `LIVE_STT_SHADOW`.
6. Deploys of the backend do not drop live audio (it goes to the separate app). Deploys of `mm-live-stt` do (Recall retries 30 x 3 s).

## Rollback

- Instant, per new bot: `fly secrets unset LIVE_STT_PROVIDER LIVE_STT_SHADOW -a summary-ai-backend` (or set `LIVE_STT_PROVIDER=recall`). Bots
  already running keep their Soniox/shadow config until they end; their segments are still accepted while the route is enabled.
- Disable the route: unset `LIVE_STT_SHARED_SECRET` (404).
- Schema: `supabase/rollbacks/026_live_stt_down.sql` only after code that selects on `shadow` is rolled back. Shadow rows become ordinary
  rows when `shadow` is dropped, so delete them first if wanted.

## Not verified until a real Recall run

Live payload format for this workspace (JSON text frames vs older binary), whether media (`video_mixed`/`audio_mixed`) is still recorded and
`recording.done` still fires when `transcript` is omitted and `audio_mixed_raw` is set, whether Recall bills raw audio or needs a 4-core bot,
speech_on/off accuracy, Recall's behaviour when the socket drops, PostgREST handling of the upsert against the unique index
(tested with fakes only), and the live-stt service against the real backend.
