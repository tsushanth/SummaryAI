# Live transcription providers (Recall built-in vs Soniox via live-stt)

Everything here is OFF by default. With no new env vars set, the backend behaves exactly as before (a regression test pins the
create-bot request body byte for byte). The separate `live-stt/` service is PR #34.

## Env vars (backend app `summary-ai-backend`)

| Variable | Default | Meaning |
|---|---|---|
| `LIVE_STT_PROVIDER` | `recall` | `recall` = Recall's own transcript for everyone (today, and the instant rollback: it overrides the two variables below). `soniox` = every user on Soniox (no Recall transcript block; Recall streams mixed raw audio to the live-stt service). `auto` = per user: Soniox for ids in `LIVE_STT_SONIOX_USER_IDS` or whose stable hash bucket is below `LIVE_STT_SONIOX_PERCENT`, Recall for everyone else. Any other value is treated as `recall`. See "Soniox primary with automatic fallback". |
| `LIVE_STT_SONIOX_USER_IDS` | unset | Comma separated user UUIDs. Only read when `LIVE_STT_PROVIDER=auto`. |
| `LIVE_STT_SONIOX_PERCENT` | `0` | 0-100 (fractions allowed). Only read when `auto`. Stable per user and monotonic: raising it never moves a user back to Recall. |
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

## Soniox primary with automatic fallback (gates; off by default)

Goal: Soniox is the live transcript for selected users (live latency p50 0.5 s against Recall's backlog), Recall is the fallback.
Every variable below defaults to today's behaviour: with none set, `createBot` produces the same request as before, no extra
query runs, and the watchdog loop is not started. (A regression test pins this.)

### Environment matrix

| Variable | Default | Effect |
|---|---|---|
| `LIVE_STT_PROVIDER` | `recall` | `recall` / `soniox` / `auto`, see the table at the top. `recall` is the rollback. |
| `LIVE_STT_SONIOX_USER_IDS` | unset | `auto` only: user ids that get Soniox (stage 1 and 2). |
| `LIVE_STT_SONIOX_PERCENT` | `0` | `auto` only: share of the other users that get Soniox (stage 3). Allowlist wins over it. |
| `LIVE_STT_FALLBACK` | on | `off`/`false`/`0`/`no`: ignore stream-failure reports, no watchdog, no hot standby. |
| `LIVE_STT_RECALL_HOT_STANDBY` | off | `true`: bots of **allowlisted** users also run Recall's transcript, hidden, so a failure switches to it. +0.15 USD per hour on those meetings. Needs `SERVICE_URL`. Not applied to users selected by percentage or `soniox`. |
| `LIVE_STT_MAX_CONCURRENT` | `3` | Concurrent Soniox bots allowed (joining, in call, recording; runs older than 6 h ignored). Keep equal to the service's `MAX_SONIOX_STREAMS`. A bot that would exceed it is created as a normal Recall-transcript bot. A failed count also chooses Recall. |
| `LIVE_STT_FALLBACK_SILENCE_SEC` | `45` | Hot standby: Recall speech this far past the last Soniox segment = Soniox silent. Above the service's own 30 s reconnect/failover window. Minimum 10. |
| `LIVE_STT_FALLBACK_NO_SEGMENTS_SEC` | `300` | Default mode: bot in the call this long and Soniox never produced a segment = unavailable. Minimum 30. |
| `LIVE_STT_FALLBACK_MIN_RECALL_WORDS` | `3` | Recall final segments with fewer words are not evidence of speech. |
| `LIVE_STT_FALLBACK_SWEEP_SEC` | `30` | Watchdog interval. The loop only starts when `LIVE_STT_PROVIDER` is `soniox` or `auto`. |
| `LIVE_STT_FILLER_FILTER` | on | `off`/`false`/`0`/`no` stores every Soniox segment as received. |
| `LIVE_STT_FILLER_EXTRA` | unset | Comma separated tokens treated as filler in every language. |
| `LIVE_STT_FILLER_ALLOW` | unset | Comma separated tokens never dropped (wins over every list). |
| `LIVE_STT_DAILY_WARN_USD` / `_DAILY_BLOCK_USD` / `_MONTHLY_BLOCK_USD` | unset (off) | Estimated spend today / this month (UTC) across ALL bots: warn, refuse new bots (503 `BOT_DAILY_BUDGET_REACHED` / `BOT_MONTHLY_BUDGET_REACHED`). |
| `LIVE_STT_USER_HOURS_WARN` / `_USER_HOURS_BLOCK` | unset (off) | One user's bot hours this month: warn / refuse (403 `BOT_USER_HOURS_REACHED`). |

Provider choice is made once per bot, when it is created (a running bot keeps its path). A bot's choice is stored in
`bot_runs.live_stt_provider` exactly as before (`soniox` for both Soniox modes), so every existing reader keeps working.

Guardrail cost model (estimates from `bot_runs`, not an invoice; vendor list prices as of 2026-11): 0.50 USD per bot hour, plus 0.12 Soniox, plus 0.15 when Recall's
transcript is on (Recall path, shadow, hot standby). Hours = joined..left, or elapsed (capped 6 h) for a bot still in the call, else
`duration_seconds`. Lookup failures fail open (bot allowed, alert `GUARD_LOOKUP_FAILED`). They overlap with the monthly allowance
(`BOT_FREE_MONTHLY_CAP_MINUTES`, on by default, `services/botUsageCap.ts`); both use the same run-time computation (`runSeconds`), the
guardrails charging a stale in-call run the 6 h ceiling and the allowance charging it nothing. A refusal inside
`POST /api/meetings/join` keeps its code (the generic "failed to dispatch" is only for other errors); the worker path treats it like
any bot creation failure.

### What "fallback" means (there is no free live Recall standby)

With `soniox` the bot is created WITHOUT Recall's transcript (that is what saves the 0.15 USD/h line). Recall documents transcription
as a bot-creation setting; its docs do not describe starting it mid-call, and the only documented route without a live transcript is
the async transcript on the finished recording (`recallai_async`). So the default fallback is the cheap one:

| Failure | Detected by | Action (default mode) | Action (hot standby, allowlist only) |
|---|---|---|---|
| Soniox rejects auth / bad config (401/402/403/400) | service reports `stream_fatal` (reason `auth`) | meeting marked `live_transcript.status = unavailable`; bot keeps recording; Soniox rows so far stay | switch to Recall at the last Soniox second |
| Service cannot connect to Soniox / reconnect + failover window exhausted | service reports `stream_degraded` (`connect`, `closed`, `error`, `degraded`) | same | same |
| Soniox concurrency / rate limit (429) or service stream cap | `stream_degraded` (`rate_limit`, `capacity`) | same | same |
| Soniox silent while audio flows | hot standby only: Recall final segment (>= 3 words) ends >= 45 s of meeting time after the last Soniox segment | not detected (a quiet meeting looks identical) | switch at the last Soniox second (`reason: silent`) |
| Service down, never connected, cold start that never connected, deploy that dropped the Recall socket | bot in call >= 300 s and Soniox never produced a segment (watchdog) | `unavailable` (`no_segments`) | via the silent rule |
| 4th concurrent meeting | at bot creation (`LIVE_STT_MAX_CONCURRENT`) | bot created with a Recall transcript (0.65 USD/h path) | same |
| Misconfigured URL/secret | at bot creation (existing) | Recall transcript bot + `LIVE_STT_MISCONFIGURED` alert | same |

What happens in each mode:
- **unavailable** (default): nothing is deleted or hidden. The final pass (Deepgram on the saved recording) still runs and
  produces the transcript. The live stitcher backstop (`stuckMeetingRecovery`) now SKIPS such a meeting (`live_incomplete`) so a
  transcript with a hole is never saved as the final one. Live insights, coaching and the voice assistant stop for that meeting.
  `GET /api/meetings/:id` adds `live_transcript: { status, reason, switched_at_sec }` for runs that had a failure (absent otherwise).
- **hot standby**: Recall's rows are stored with `live_transcripts.shadow = true` and `source_key` null (hidden, no insights). On
  failure the run is switched: hidden Recall rows with `start_timestamp >=` the last Soniox end become visible, later Soniox rows are
  stored hidden, insights are re-queued. No Soniox row is ever deleted or hidden retroactively. The stitched transcript is labelled
  `soniox_recall_fallback`. A Recall segment straddling the switch second can repeat a few words.
- **Retry at most once.** The Soniox retry is the service's own bounded reconnect (replay from its watermark). The backend adds one
  rule (default mode): if segments arrive again after an outage was declared, the meeting returns to `ok` once
  (`retries_used = 1`); a second failure is final for that meeting, and a later recovery is not cleared again. A stream that was only
  late to its first segment (`no_segments`) clears without using the retry. Hot standby is one-way (no flip back).
- State lives in `bot_runs.live_stt_fallback` (migration 030, jsonb: active, mode, switched_at_sec, reason, retries_used, last 8
  events; no text, no ids). Everything is decided from the database, so any Fly machine can act. The switch is idempotent.
  Without migration 030 the code still runs: reports answer `fallback: unsupported`, an alert `LIVE_STT_FALLBACK_MIGRATION_MISSING`
  is raised once an hour and Soniox simply stays the source. A missing column is remembered for 5 minutes only, so applying migration
  030 takes effect without a restart.

Service contract (the service does not send these yet, see "Service changes needed"): `POST /internal/live-segments` with the usual
signature and body `{"v":1,"ref":...,"sessionId":...,"event":{"type":"stream_fatal"|"stream_degraded","reason":"auth"|"connect"|"closed"|"rate_limit"|"error"|"degraded"|"capacity","code":429?}}`
(no `segments`; exactly one of the two). `reason` is a fixed list; no free text is accepted. Until the service sends them, only the
silent/no_segments detection is active.

### Filler filter

`lib/liveSttFiller.ts`, applied in `POST /internal/live-segments` to Soniox-primary rows only (shadow rows, Recall rows and the final
transcript are untouched). A segment is dropped when every token is a hesitation sound for its language (segment `language`, else
the meeting's), or it has no letter or digit at all (`...`, `-`). Dropped: Hmm, Mm, Mhm, Mm-hmm, Uh, Um, Er, ... and the language
lists (de Äh, fr Euh, es Eh, ja えーと, zh 呃, ru Ээ, ...). Kept: Yes, No, OK, Okay, Yeah, Nope, Sure, Right, Oh, Ah, Huh, anything
with a digit, Uh-huh and Uh-uh (they carry yes/no), a segment mixing a filler with real words (never rewritten), and words that
are fillers elsewhere but real here (German er/um, ja うん/ええ/はい, zh 嗯, ko 응). Unknown language = English list. Counter
`live_stt_filler_dropped{lang}`; text is never logged. Not handled: the 19 non-English-script segments of the shadow run (language
ID mislabels in Auto) and "merge" of fillers into neighbours.

### Observability

In-process counters (per machine), logged as `[LiveSttMetrics] {...}` once a minute while something changed, and structured events
`[LiveStt] {"evt":...}`. Labels are provider/reason/language codes only; a meeting is its ref's first 8 characters; no transcript
text, names, user ids or secrets (a test greps the logs for them).
Counters: `live_stt_provider_selected{provider,selection}`, `live_stt_capacity_redirect`, `live_stt_segments_stored{provider,hidden}`,
`live_stt_filler_dropped{lang}`, `live_stt_stream_events{type,reason}`, `live_stt_fallbacks{mode,reason,source}`,
`live_stt_recoveries{reason}`, `live_stt_fallback_unsupported`, `live_stt_stitch_skipped_incomplete`, `live_stt_guard_warn{kind}`,
`live_stt_guard_blocked{code}`, `live_stt_guard_lookup_failed`, `live_stt_capacity_check_failed`.
Latency: `live_stt_segment_lag{provider=soniox}` summary (count, mean, max, buckets <=1/2/5/15/60 s, more) =
`arrival time - joined_at - segment end`; approximate (the bot's join time stands in for the recording start, a few seconds of
offset). It is recorded for Soniox only; Recall's lag needs the hidden rows' `created_at`.
Alerts (existing central reporter, deduped hourly): `GUARD_*`, `LIVE_STT_FALLBACK_MIGRATION_MISSING`.

### Session stickiness (multi-machine hazard)

Facts (read-only, 2026-11-10): `mm-live-stt` has exactly ONE machine (shared-cpu-1x, 256 MB, iad, scale to zero,
`MAX_SONIOX_STREAMS=3`, `MAX_SESSIONS` 3). A session is a `Map` entry in that process: replay buffer, Soniox watermark, token anchors,
speaker map, delivery queue, and (language branch) the pending language changes. Fly only STARTS machines that already exist, so
the app stays on one machine unless someone runs `fly scale count`/clones a machine. Hazards if it ever has two:
1. A Recall reconnect for the same ref can land on the other machine: a fresh session (empty buffer and watermark), a second Soniox
   stream (double billing, double concurrency), segment keys that differ, so the same words can be stored twice.
2. `POST /control/language` can land on a machine without the session: it queues there and the running stream is not switched.
3. The 3-stream cap and the Soniox org limit (10, shared) become per machine.
What this PR does about it: nothing in the service (it is not in this repo's main; the code lives on `feat/live-stt-service` and
`feat/meeting-language-live-stt`). Backend side: the capacity check is global (counts active Soniox runs in the database), so it
bounds total concurrency across machines; a language change that lands on the wrong machine is already reported as `live_applied: false`.
**BLOCKER for more than one machine** (exact change list, none of it done):
- Do not scale the app past one machine before this is built: keep `fly scale count 1 -a mm-live-stt` and do not raise `min_machines_running` above 1.
- Service: choose the owner machine of a ref by rendezvous hash of the ref over the machine list (`vms.mm-live-stt.internal` TXT), and
  answer a non-owner request with `fly-replay: instance=<owner>` for the ingest WebSocket upgrade AND for `POST /control/language`.
  Whether `fly-replay` works for a WebSocket upgrade request is NOT verified: test it before relying on it.
- Service: global stream cap (shared counter, or Soniox limit divided across machines) instead of a per-process limit.
- Alternative for the control call only: the service adds `FLY_MACHINE_ID` to its sink body, the backend stores it per run and sends
  `fly-force-instance-id: <id>` on the control request. That fixes hazard 2, not hazard 1.
- Deploys of the service drop live sessions (Recall retries 30 x 3 s): not changed; the watchdog turns that into `no_segments`.

### Service changes needed (separate PR on the live-stt branch, not part of this PR)

1. Send the health events above from `session.ts` where it already raises `soniox_fatal`, `soniox_concurrency_429`, `mm_stream_cap` and
   `live_degraded` (through the existing HTTP sink, same signature).
2. Optional `language` on every segment is already sent; keep it (the filler filter uses it).
3. Stickiness as above if a second machine is ever wanted.

### Cold start and infra follow-ups (not done: no infra changes in this PR)

`mm-live-stt` scales to zero. The first Recall connection starts the machine (Recall retries every 3 s), so the first 3-10 seconds of
a meeting can be missing from the live transcript (the final pass has them). Recommended follow-ups, both outside this PR:
`min_machines_running = 1` on `mm-live-stt` (about 2.19 USD/month), or a pre-join ping from the backend about 60 s before a scheduled join.

### Rollout runbook (each step is an env change on `summary-ai-backend`; none has been done)

0. Prerequisites: migration 026 applied (it is, the shadow ran), apply `supabase/migrations/030_live_stt_fallback.sql` (ask -af; nullable
   column, metadata only). Deploy this code with NO env change (identical behaviour).
1. Allowlist: `LIVE_STT_PROVIDER=auto`, `LIVE_STT_SONIOX_USER_IDS=<test user ids>`. Leave `LIVE_STT_SHADOW*` as they are (a selected user is
   no longer shadowed; the others keep the shadow). Optional for this stage only: `LIVE_STT_RECALL_HOT_STANDBY=true`. Set the guardrail variables to values that fit the stage.
2. Add the maintainers' own ids to the allowlist. Run real meetings, including one where the service is stopped mid-call.
3. Small percentage: `LIVE_STT_SONIOX_PERCENT=5`, then 25, 50 (check the watch list between steps; hot standby does not apply).
4. Everyone: `LIVE_STT_PROVIDER=soniox` (or percent 100). Re-check the concurrency cap and the Soniox org limit first: with 3 streams, 4+
   concurrent meetings are redirected to Recall transcript bots.
5. Rollback at any step: `LIVE_STT_PROVIDER=recall` (new bots only; running bots keep their path and their rows stay valid). Nothing else
   needs to change; `LIVE_STT_FALLBACK=off` stops the fallback bookkeeping.

What to watch: `fly logs -a summary-ai-backend | grep -E "LiveStt"`: `live_stt_fallbacks` (any is worth reading), `live_stt_capacity_redirect`
(the cap is binding), `live_stt_segment_lag` (Soniox lag should be ~1-2 s; seconds beyond that = service trouble), `live_stt_filler_dropped`
(roughly 60% of Soniox segments was the 2026-11-07 junk rate; a sudden 0 or 100% means the filter or the stream broke),
`live_stt_stream_events` (needs the service change), `live_stt_guard_*`, alerts `GUARD_*` and `LIVE_STT_FALLBACK_MIGRATION_MISSING`.

### Not verified (needs a real Recall/Soniox run or an owner answer)

- Whether Recall still records media and fires `recording.done` for a bot created without a transcript block (docs do not say; a
  Soniox-only bot has never run in production, only shadow bots with a transcript block). The final pass depends on it: test one real
  Soniox-only meeting before widening, and check that the recording and the final transcript appear.
- Whether Recall can start transcription mid-call (docs fetched 2026-11-10 do not mention it; the only post-hoc route is `recallai_async`).
- Whether Recall bills raw audio or needs a 4-core bot (+0.10 USD/h).
- Soniox and Recall time bases: the silent rule compares Recall's `relative` seconds with the service's segment seconds (a few seconds
  of offset is covered by the 45 s threshold; a larger offset would not be).
- That the service's `language` per segment is always present for Auto meetings; without it the English list plus universal sounds is used.
- The row-flip race: a Recall row inserted in the milliseconds around a switch by a request that read the old state stays hidden
  (at most one segment per switch; the final transcript is unaffected).
- Everything here is tested with fakes (in-memory database, fake service); nothing ran against Supabase, Recall or Soniox.

## Rollout of the original shadow-then-switch path (superseded by the runbook above for the primary rollout)

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
