# In-meeting voice assistant

The Meeting Mind bot that joins a call can answer spoken questions. Someone says **"Meeting Mind, ..."** and the bot answers out loud, from the live meeting and, for the account owner only, from that owner's past meetings.

Server side only: no Android, iOS or web client change is needed. Code: `backend/src/services/voiceAssistant/`, routes in `backend/src/routes/voiceAssistant.ts`, migration `backend/supabase/migrations/029_voice_assistant_events.sql` (optional, not applied by the PR).

## Behaviour

- The bot **never speaks unprompted**. It speaks only when (a) an utterance **starts** with the wake phrase ("Meeting Mind", "hey Meeting Mind", speech-to-text variants such as "meeting mined"), or (b) once, a short intro when it joins ("Hi, this is Meeting Mind. I'm recording this meeting. To ask me something, say Meeting Mind, then your question."). "We use Meeting Mind for notes" does not trigger it.
- A wake phrase alone ("Meeting Mind.") waits 12 seconds for that same person's next sentence.
- It says **"Let me check."** at once, then the answer (at most about 35 words, hard cap 450 characters).
- **Barge-in**: anyone talking over it (3+ words, also on partial transcripts) or saying stop / never mind / cancel / enough stops the audio immediately (Recall `DELETE output_audio`). A new wake phrase while it is thinking replaces the old question.
- **Stale answers are dropped**: after barge-in, after a newer question, or when ready more than 30 s after the question.
- **Echo guard**: the bot's own speech comes back through the meeting audio. Utterances labelled with the bot's name, and utterances whose words are mostly contained in something the bot said in the last 90 s (intro, cue, answers), are ignored. The wake phrase is stripped from everything the bot says. A self-trigger breaker disables the assistant for the meeting after 4 questions in 15 s.
- **Privacy**: the live meeting can be asked about by any participant (they all heard it). **Past meetings are only read for the account owner**, recognised by email (if Recall gives one) or by name matching the profile / auth display name (a single first name only counts for the meeting host). For anyone else the model is not given the history tools or the meeting index and says it can only look up past meetings for the account owner. Policy knob below. Data access is bound to the user of the `bot_runs` row of that Recall bot (never to anything in the webhook), and every query is restricted to that user's recordings (`test/voiceAssistant/isolation.test.ts`).
- Calendar event titles, descriptions and attendees are never read (DATA_SEGREGATION.md). Question and answer text are not stored anywhere by this feature.

## Flags (all environment variables, read at call time; defaults shown)

| Variable | Default | Meaning |
|---|---|---|
| `VOICE_ASSISTANT_MODE` | `off` | `off`, `opt_in` (profile preference true, or id in `VOICE_ASSISTANT_USER_IDS`), `all` (everyone who has not opted out). **Enable for all users with one flip: `VOICE_ASSISTANT_MODE=all`.** |
| `VOICE_ASSISTANT_KILL` | unset | `1`/`true` = global kill switch. New bots get no assistant, a running one goes silent on its next event and stops any audio. |
| `VOICE_ASSISTANT_USER_IDS` | unset | comma separated user UUIDs for `opt_in` mode |
| `VOICE_ASSISTANT_HISTORY_POLICY` | `owner` | who may use past meetings: `owner` (email or name match), `owner_email` (email only), `anyone` (not recommended), `off` (live meeting only) |
| `VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING` | `15` | then it says once that it reached its limit |
| `VOICE_ASSISTANT_MAX_QUESTIONS_PER_USER_DAY` | `40` | per user per UTC day, across meetings |
| `VOICE_ASSISTANT_MAX_ANSWER_CHARS` | `450` | cap on the spoken answer |
| `VOICE_ASSISTANT_DAILY_SPEND_CAP_USD` | `10` | global breaker on the LLM + TTS estimate per UTC day; over it the assistant is silent and an alert is raised |
| `VOICE_ASSISTANT_FAILURE_ALERT_RATE` / `_MIN_ATTEMPTS` | `0.3` / `8` | alert when failures / attempts in the last hour exceeds the rate |
| `VOICE_ASSISTANT_STALE_MS` / `_ANSWER_TIMEOUT_MS` | `30000` / `20000` | stale-answer window, think timeout |
| `VOICE_ASSISTANT_MODEL` | `SUMMARY_MODEL` (Haiku 4.5) | model for answers |
| `VOICE_ASSISTANT_TTS_PROVIDER` / `_TTS_VOICE` / `_TTS_USD_PER_1K_CHARS` | `deepgram` / `aura-asteria-en` / `0.015` | see TTS below; the price is only for the cost estimate |
| `VOICE_ASSISTANT_INTRO` / `VOICE_ASSISTANT_CUE` | on / on | the join intro, the "Let me check." cue |

A user can opt out (or in) themselves: `PUT /api/voice-assistant {"enabled": false}` (authenticated, writes `profiles.preferences.voice_assistant`; `false` wins in every mode, `GET` shows the effective state). No client uses it yet; it exists so support can flip a user and a client can add a toggle later. A bot only gets the assistant if the flags allow it **when the bot is created**; the kill switch also applies to bots already in a meeting.

Requirements already in production: `RECALL_API_KEY`, `INTERNAL_SECRET` (signs the assistant webhook URL), `SERVICE_URL`, `DEEPGRAM_API_KEY` (TTS), `ANTHROPIC_API_KEY`. If `INTERNAL_SECRET` or `SERVICE_URL` is missing the bot is created without the assistant. It also needs Recall's own real-time transcript (the default; not the `LIVE_STT_PROVIDER=soniox` path).

## TTS (server side)

Deepgram Aura REST, MP3, because the backend already has `DEEPGRAM_API_KEY` and it is the fastest server TTS available to us. Measured 2026-11-09 from a laptop, one sentence of speech: Aura-1 `aura-asteria-en` 0.13 to 0.23 s total, Aura-2 `aura-2-thalia-en` 1.5 to 2.5 s (it renders at roughly real time over REST), so Aura-1 is the default. OpenAI `tts-1` exists as `VOICE_ASSISTANT_TTS_PROVIDER=openai`, off by default (the portfolio is moving off OpenAI). The macOS `say` of the prototype is not usable on Linux. The ReadAloud / system-TTS rules are for client apps, not this server bot. The intro, cue and apology are synthesized once per process and cached.

## Metrics

Per event (no transcript, question or answer text, no speaker names, no meeting titles):

- structured log line per event: `fly logs -a summary-ai-backend | grep '"event":"voice_assistant"'`
- table `voice_assistant_events` (migration 029, **apply it for restart-proof caps and multi-day roll-ups**; without it the backend detects the missing table once, logs a warning and keeps counters in memory for the day)
- daily gauges pushed to the central Worker (`POST /v1/usage`, app `meetingmind`, metrics `voice.*`: `wake_detections, questions, answered, no_answer, failures, barge_ins, stale_dropped, echo_suppressed, meetings, users, ttfa_p50_ms, ttfa_p95_ms, answer_p50_ms, answer_p95_ms, cost_usd`), visible on the Worker `/admin` page next to the other usage metrics

Read the roll-up: `curl -H "x-internal-secret: $INTERNAL_SECRET" https://summary-ai-backend.fly.dev/internal/voice-assistant/rollup?days=7`. For each UTC day: wake detections, questions, answered, "no answer found", failures by type (`llm, tts, play, timeout, internal`), failure rate, barge-ins, stale drops, echo suppressions, cap hits by kind, history denied (non-owner asks), p50/p95 of **time to first audio** (end of question received -> cue or answer accepted by Recall) and **answer time**, meetings and users with questions, per-user top 10, LLM + TTS cost estimate per day and per answer. The SQL for the same is at the bottom of the migration.

Alerts (through `lib/alerts.ts`, deduped by the Worker, emailed): `FAILURE_RATE_HIGH` (hourly failure rate over the threshold), `DAILY_SPEND_CAP_REACHED`, `WEBHOOK_UNAUTHORIZED`, `NO_WEBHOOK_SECRET`, `SESSION_INIT_FAILED`.

What the latency numbers do not include: Recall's own speech-to-text delay before the webhook arrives, and Recall's delay between accepting the audio and playing it.

## Cost per answer (estimate)

About 0.5 to 2 LLM calls with about 1.5k input tokens each on Haiku 4.5 (about $0.006 to $0.012, measured $0.0116 mean on 20 real questions) plus TTS about $0.0005 (30 words, $0.015/1k chars). The intro and cue are cached. Recall bills the bot by the hour regardless; output audio is not a separate line as far as we know (check the Recall invoice after the first week). A 1-hour meeting with 5 questions is about $0.05 on top of the bot.

## Rollback

1. Fastest: `flyctl secrets set VOICE_ASSISTANT_KILL=1 -a summary-ai-backend` (adding a new secret, restarts the machine, about 10 s; a running bot is silenced and stops talking). Or set `VOICE_ASSISTANT_MODE=off` (stops new bots getting it; the kill switch also silences running ones).
2. Code: redeploy the previous release (`flyctl releases -a summary-ai-backend`, then `flyctl deploy --image <previous image>`). The migration is additive and can stay.
3. Fully remove the table (only if wanted): `drop table voice_assistant_events;`.

## Live test checklist (about 2 minutes, host needed)

Before: deploy with `VOICE_ASSISTANT_MODE=opt_in` and your user id in `VOICE_ASSISTANT_USER_IDS` (or `all`), start a Google Meet from your account.

1. Start the Meeting Mind bot for that meeting, host **admits "Meeting Mind"** from the waiting room. Expect the short intro.
2. Say "Meeting Mind, what did we just talk about?" (after saying a few sentences). Expect "Let me check." immediately, then a short answer, no overlap between the two.
3. Say "Meeting Mind, what did we decide in my last meeting about <something real>?" Expect an answer from your history.
4. Ask a long-ish question and **talk over the answer**. Expect the audio to stop within about a second, and no second answer afterwards.
5. Say "Meeting Mind" and wait. Expect nothing until you ask. Say a sentence that merely mentions Meeting Mind in the middle. Expect silence.
6. Watch for the bot answering **itself** (its voice re-transcribed) and for the cue and answer talking over each other. If either happens, flip the kill switch and capture the log lines (`"event":"voice_assistant"`).
7. Afterwards read the roll-up (above): one wake, 2 to 3 questions, a barge-in, ttfa and answer times, cost.
8. With a second person (not the account owner) saying "Meeting Mind, what did we discuss last week?": expect "I can only look up past meetings for the account owner."

## What has not been verified live

A host-admitted live test has not been run. Untested against real Recall audio: barge-in end to end (the Recall stop call), cue/answer overlap on a real call, whether Recall transcribes the bot's own voice and under what participant name (the echo guard handles both a bot-labelled and an anonymous echo, tested with replayed events), speaker attribution of the wake phrase in a crowded or shared-microphone room, and whether Recall supplies participant emails (name matching is the fallback).
