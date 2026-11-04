# Live transcription providers (Recall built-in vs Soniox via live-stt)

Everything here is OFF by default. With no new env vars set, the backend behaves exactly as before (a regression test pins the
create-bot request body byte for byte). The separate `live-stt/` service is PR #34.

## Env vars (backend app `summary-ai-backend`)

| Variable | Default | Meaning |
|---|---|---|
| `LIVE_STT_PROVIDER` | `recall` | `recall` = Recall's own transcript (today). `soniox` = no Recall transcript block; Recall streams mixed raw audio to the live-stt service. Any other value is treated as `recall`. |
| `LIVE_STT_SHADOW` | unset | Exactly `true` = keep Recall's transcript as the source of truth AND stream audio to live-stt; its segments are stored with `shadow=true` and ignored by every reader. Ignored when `LIVE_STT_PROVIDER=soniox`. |
| `LIVE_STT_SHADOW_USER_IDS` | unset | Comma separated user UUIDs. Shadow only applies to bots created for these users; unset/empty/no user id = shadow OFF for everyone, even with `LIVE_STT_SHADOW=true` (shadow sends meeting audio to a second speech vendor, so it is opt-in per user). Does not affect `LIVE_STT_PROVIDER=soniox`. |
| `LIVE_STT_WS_URL` | unset | Public base URL of the live-stt app, e.g. `wss://mm-live-stt.fly.dev` (no path; must be `wss://` in production). |
| `LIVE_STT_INGEST_SECRET` | unset | HMAC secret for the per-bot URL token. Equals the service's `INGEST_TOKEN_SECRETS` (current secret first). |
| `LIVE_STT_SHARED_SECRET` | unset | HMAC secret for `POST /internal/live-segments`. Equals the service's `BACKEND_SINK_SECRET`. Comma separated list accepted (rotation). Unset = the route answers 404. |
| `LIVE_STT_CONTROL_SECRET` | first `LIVE_STT_SHARED_SECRET` | HMAC secret for the live language change call to the service (service `CONTROL_SECRETS`). |
| `RECALL_AUTO_LANGUAGE` | unset | `detect` = `auto` meetings use Recall language detection (accuracy mode, live captions 3-10 min late). Anything else keeps English low latency. |
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
- Language: see "Transcription language" below. The stitched fallback transcript no longer hard-codes `en` (see there).

## Transcription language (per meeting)

A meeting can carry a transcription language: `auto` (default) or one of 35 languages. It is chosen when the meeting is added or the
bot is sent, defaults to the user's saved default, and (Soniox path only) can be changed while the meeting is live.

Supported list (BCP-47 primary subtag, the intersection of Recall `recallai_streaming` accuracy mode and Soniox, so one code is valid
on every path; sources fetched 2026-11-03):
`bg ca cs da de el en es et fi fr he hi hr hu id it ja ko lt lv ms nl no pl pt ro ru sk sv th tr uk vi zh`.
Region/script subtags are accepted and dropped (`fr-CA` -> `fr`), legacy `iw/in/nb/nn` map to `he/id/no`; anything else is a 400.
Soniox alone also supports af sq ar az eu be bn bs gl gu kn kk mk ml mr fa pa sr sl sw tl ta te ur cy (60 total); Recall does not,
so they are NOT offered. Deepgram nova-2 (final transcript) supports all of the 35 except `he` and `hr`, which keep `detect_language`.

| Path | Auto (default) | A chosen language | Change mid-meeting |
|---|---|---|---|
| Recall transcript (today) | unchanged body: `prioritize_low_latency` + `language_code: "en"` (live captions are English). Opt in with `RECALL_AUTO_LANGUAGE=detect` to use Recall detection (`language_code: "auto"`, accuracy mode) | `prioritize_accuracy` + `language_code: <code>` | NO. Fixed when the bot is created; Recall documents no way to change it. `POST /live-language` answers 409 `LIVE_LANGUAGE_FIXED` |
| Soniox live (`LIVE_STT_PROVIDER=soniox`) | no hints, `enable_language_identification` on (per-token language id) | one `language_hints` entry (a bias, not a lock) | YES, see below |
| Final transcript (Deepgram) | `detect_language=true` (unchanged) | `language=<code>` instead (retry once with detect on a 400) | the latest choice is used |
| Final transcript (Soniox async) | identification on | `language_hints: [code]` | the latest choice is used |

Recall constraints, verbatim from docs.recall.ai/docs/recallai-transcription: "When `mode` is set to `prioritize_low_latency`,
`language_code` must be set to `en`. Do not set `language_code` to `auto` or any non-English language code" (other codes "will fail to
transcribe"); `auto` (language detection and code switching) and every other language need `prioritize_accuracy`, whose realtime
events are "typically delayed by 3-10 minutes". So on the Recall path choosing any non-English language trades live latency for
correct language: live transcript, live insights and coaching arrive minutes late for that meeting. That is why `auto` stays English
low-latency by default (switching every user to a 3-10 minute delay would break the live features), and why the UI says so.
Not verified without a real Recall run: that the webhook handler needs no change for accuracy-mode payloads, and that `zh` covers the
variants users expect.

Storage (migration `027_transcription_language.sql`, **not applied; ask -af**): `meetings.transcription_language` (NULL = never chosen,
follows the owner's default when the bot joins; `auto` = explicit) and `bot_runs.transcription_language` (what the bot actually
used; NULL = auto). The user's default lives in `profiles.preferences.default_transcription_language` (no migration). The code works
BEFORE the migration: columns are only written when a language is chosen, an insert/update that fails because the column is missing
is retried without it (so bot_runs/meetings rows are never lost) and the API returns a `warning`; reads fall back to auto.

API (all under `/api/meetings`, authenticated):
- `GET /transcription-languages` -> `{ auto, default_language, languages: [{code,name,native}], live: { provider, can_change_during_meeting, english_only_low_latency, non_english_live_delay_minutes, auto_live_behaviour } }`
- `PUT /transcription-languages/default {language}` -> `{ default_language }`
- `POST /` (add meeting), `POST /join` (instant), `POST /:id/join-now`, `PATCH /:id`: optional `transcription_language`. Unknown -> 400.
  Resolution at bot creation: request > the meeting's stored value (`auto` counts) > the user's default > auto. Scheduled and
  calendar-synced meetings resolve when the bot joins.
- `GET /:id` additionally returns `transcription_language` and `live_language: { language, can_change, reason: null|'not_live'|'provider_fixed', provider }`.
- `POST /:id/live-language {language}`: 400 invalid; 404 not yours; 409 `MEETING_NOT_LIVE`; 409 `LIVE_LANGUAGE_FIXED` (Recall path);
  200 `{ ok, language, live_applied, live_state?: 'applied'|'queued', message? }` on the Soniox path. `live_applied:false` means the
  choice is saved (final transcript uses it) but the live service could not be reached.

Soniox live mechanics: the initial language rides in the ingest URL (`...?token=<hex>&lang=es`, absent for auto; the token is still
HMAC(secret, ref) only). A change is a signed call backend -> service `POST <LIVE_STT_WS_URL as https>/control/language`
`{"v":1,"ref":"<live_stt_ref>","language":"es"|"auto"}` with `x-mm-timestamp` and `x-mm-signature: v1=hex(HMAC-SHA256(secret,
"control.<ts>.<raw body>"))` (5 minute window; the `control.` prefix separates it from the segment-sink signature). Secret: backend
`LIVE_STT_CONTROL_SECRET` (default: first `LIVE_STT_SHARED_SECRET`) = service `CONTROL_SECRETS` (default `BACKEND_SINK_SECRET`). The service
closes the running Soniox stream without finalizing it, opens a new one with the new `language_hints` and replays the buffered audio
from 1 s before the old stream's final watermark (15 s buffer, same code as a reconnect), so words already final are kept, the not
yet final tail is re-recognised in the new language, nothing is lost or duplicated (replay test: 0.00% word loss, 100% audio
coverage). If the meeting's audio has not connected yet the change is queued (202, 1 h, max 500 refs). Limits: the session lives in
one Fly machine's memory; with more than one machine the call can hit the wrong one (it then queues on that machine and the live stream is not switched; the final transcript still gets the
choice). `fly.toml` does not pin the app to one machine; at the current scale (3 streams) it normally runs one. A very rapid series of changes reopens the stream each
time (rate limited at 600 control calls/min/IP).

Final transcript: processing looks up the recording's meeting -> latest bot run (else meeting) language and passes it as a hint.
One language per recording: for a meeting that genuinely mixes languages choose Auto-detect. Uploads and unknown values are auto.

Stitched fallback (`stitchStuckRecording`): `transcripts.language` is the run's chosen language; with nothing chosen the Recall
transcript really was English (`en`); for Soniox auto (or Recall detection) it is detected from the text (script, then stop words,
default `en`) instead of the old hard-coded `en`.

## Rollout (nothing below has been done)

0. Language feature: apply `supabase/migrations/027_transcription_language.sql` (ask -af; optional, the code works without it but a chosen
   language is then ignored with a warning). The live language CHANGE needs the Soniox path (step 5) and the service redeployed with
   the control route; until then the endpoint answers 409 `LIVE_LANGUAGE_FIXED`. Per-meeting language on the Recall path works as soon as
   the backend is deployed.
1. Apply `supabase/migrations/026_live_stt.sql` to the MeetingMind Supabase project FIRST. The new reader filters select on
   `shadow`; deploying the code before the migration makes live transcripts, insights and Q&A fall back to empty.
2. Choose two random secrets. Set on `summary-ai-backend`: `LIVE_STT_SHARED_SECRET`, `LIVE_STT_INGEST_SECRET` (new secrets only,
   never overwrite existing ones). Deploy the backend (no behaviour change yet).
3. Deploy the `mm-live-stt` app (PR #34) with `INGEST_TOKEN_SECRETS` = ingest secret, `BACKEND_SINK_SECRET` = shared secret,
   `BACKEND_SINK_URL` = `https://summary-ai-backend.fly.dev/internal/live-segments`, `SONIOX_API_KEY`.
4. Shadow first: set `LIVE_STT_WS_URL`, `LIVE_STT_SHADOW_USER_IDS=<test user uuid(s)>` and `LIVE_STT_SHADOW=true` (without the allowlist nobody is shadowed). Run one real meeting. Compare `live_transcripts` rows with
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
