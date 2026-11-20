# In-meeting voice assistant

The Meeting Mind bot that joins a call can answer spoken questions. Someone says **"Meeting Mind, ..."** and the bot answers out loud, from the live meeting and, for the account owner only, from that owner's past meetings.

Server side plus an on/off switch for the user: Android (Settings > "Voice assistant in meetings", `android/.../ui/settings/VoiceAssistantSetting.kt`) and the web dashboard (Settings > "Voice assistant in meetings", `web/src/components/settings/VoiceAssistantCard.tsx`). Both read and write the `/api/voice-assistant` endpoint below. There is no iOS switch. Code: `backend/src/services/voiceAssistant/`, routes in `backend/src/routes/voiceAssistant.ts`, migration `backend/supabase/migrations/029_voice_assistant_events.sql` (optional, not applied by the PR).

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
| `VOICE_ASSISTANT_WAKE_SOURCE` | `recall` | `recall` (Recall's real-time transcript, as before) or `live_stt` (see Wake source below). Has no effect on a bot without a live-stt stream. |
| `VOICE_ASSISTANT_MAX_QUESTIONS_PER_MEETING` | `15` | then it says once that it reached its limit |
| `VOICE_ASSISTANT_MAX_QUESTIONS_PER_USER_DAY` | `40` | per user per UTC day, across meetings |
| `VOICE_ASSISTANT_MAX_ANSWER_CHARS` | `450` | cap on the spoken answer |
| `VOICE_ASSISTANT_DAILY_SPEND_CAP_USD` | `10` | global breaker on the LLM + TTS estimate per UTC day; over it the assistant is silent and an alert is raised |
| `VOICE_ASSISTANT_FAILURE_ALERT_RATE` / `_MIN_ATTEMPTS` | `0.3` / `8` | alert when failures / attempts in the last hour exceeds the rate |
| `VOICE_ASSISTANT_STALE_MS` / `_ANSWER_TIMEOUT_MS` | `30000` / `20000` | stale-answer window, think timeout |
| `VOICE_ASSISTANT_MODEL` | `SUMMARY_MODEL` (Haiku 4.5) | model for answers |
| `VOICE_ASSISTANT_TTS_PROVIDER` / `_TTS_VOICE` / `_TTS_USD_PER_1K_CHARS` | `deepgram` / `aura-asteria-en` / `0.015` | see TTS below; the price is only for the cost estimate |
| `VOICE_ASSISTANT_INTRO` / `VOICE_ASSISTANT_CUE` | on / on | the join intro, the "Let me check." cue |

A user can opt out (or in) themselves: `PUT /api/voice-assistant {"enabled": false}` (authenticated, writes `profiles.preferences.voice_assistant`; `false` wins in every mode, `GET` shows the effective state `{enabled, reason, preference, mode}`; `PUT` takes `{"enabled": boolean}` (anything else is a 400) and returns the same shape). The Android app and the web dashboard use it for the user-facing switch; support can also flip a user with it. A bot only gets the assistant if the flags allow it **when the bot is created**, so turning the switch ON takes effect from the next meeting's bot (a bot already in a meeting that was created without the assistant stays without it). Turning it OFF also silences a bot that is already in a meeting: a running session re-reads the preference at most every 15 s (`PREFERENCE_REFRESH_MS`), and the kill switch applies to running bots immediately.

Requirements already in production: `RECALL_API_KEY`, `INTERNAL_SECRET` (signs the assistant webhook URL), `SERVICE_URL`, `DEEPGRAM_API_KEY` (TTS), `ANTHROPIC_API_KEY`. If `INTERNAL_SECRET` or `SERVICE_URL` is missing the bot is created without the assistant. It also needs Recall's own real-time transcript (the default; not the `LIVE_STT_PROVIDER=soniox` path).

## Wake source: Recall or the live-stt (Soniox) stream

Recall's real-time transcript runs in low-latency mode (accuracy mode would delay it by minutes, and low-latency mode takes no key terms), and it mishears or drops the start of an utterance, which is exactly where the wake phrase is. In a live test with three wake questions, Recall's stream recognised one: it heard "meeting my invading we decided in my" for one, and for another it dropped the leading words, with its final arriving about 5 s after speech end. The Soniox stream (live-stt service, `backend/LIVE_STT.md`) got all three right, and its finals arrived about 1 s after speech end.

With `VOICE_ASSISTANT_WAKE_SOURCE=live_stt`, a bot that has a live-stt stream (bot run with `live_stt_provider` `shadow` or `soniox`) takes its wake phrase and question from that stream:

- Final segments that `POST /internal/live-segments` has just stored are handed to the same assistant session as Recall events (same caps, echo guard, kill switch, owner rules). Only newly inserted segments are forwarded, so the live-stt service's retries cannot ask twice. The forward is fire-and-forget: it can never slow down or fail the sink, and nothing is logged about its content.
- Recall's finals for that bot are then ignored (no wake, no question, no second answer, no second metrics). Recall's partials are still used as barge-in signals: someone else talking over the answer, or a stop word, stops the audio. The asker's own late Recall partials, which trail the live-stt stream by several seconds, are never a barge-in.
- live-stt splits one spoken question into several finals ("Meeting mind, what" / "did we decide in my" / "last meeting with Prajni?"). The assistant keeps the first words after the wake phrase, and a question that does not end in punctuation waits 1.2 s for the rest of the same speaker's finals. The wait is counted in the answer-time metrics.
- Speaker identity: the live-stt payload has a speaker name and a host flag but no email. The assistant fills in the email (and host flag) from what Recall has reported for the same name earlier in the meeting. With `HISTORY_POLICY=owner_email` and no email seen yet, history is denied (fails closed); the default `owner` policy matches on the name.
- Fallback: a bot without a live-stt stream uses Recall exactly as before. If a live-stt stream goes quiet (three Recall finals in a row with no live-stt final in between), Recall finals are accepted again until live-stt delivers, and the same wake phrase reported by both streams within 15 s is acted on once.

How to enable: set `VOICE_ASSISTANT_WAKE_SOURCE=live_stt` (a normal secret change, restarts the machine). Nothing else changes. It only does something for bots that already have a live-stt stream, i.e. users in `LIVE_STT_SHADOW_USER_IDS` (with `LIVE_STT_SHADOW=true`) or everyone when `LIVE_STT_PROVIDER=soniox`. Revert by unsetting it (or `recall`).

Cost: no new Soniox spend for users who are already shadowed, since their audio is already being streamed and transcribed; the assistant only reads the segments that are already stored. The flag does not enable live-stt for anyone. Extending live-stt to all users is a separate spend decision (Soniox per audio hour for every meeting, plus the live-stt service capacity); do not make it just to turn this on. For a `LIVE_STT_PROVIDER=soniox` bot (no Recall transcript at all) the assistant is not wired in at bot creation (no intro, no Recall real-time endpoint; with `MEETING_ASSISTANT_MULTILINGUAL` on it gets the intro, see "Other languages"), so with this flag it can answer, but it has no Recall partials for barge-in; live-stt stop words and new questions still interrupt.

Known limits: segment text is whatever Soniox heard, with no confidence; a stream replayed after a long outage could carry an old question (the answer is dropped after `VOICE_ASSISTANT_STALE_MS` counted from arrival, not from when it was spoken); the live-stt speaker name comes from Recall's speech events, so a renamed or shared-mic participant can be misattributed as with Recall.

## Other languages (MEETING_ASSISTANT_MULTILINGUAL, default OFF)

With the flag off nothing below exists: the English assistant behaves exactly as described above (the English prompt is byte-identical, `wake.ts` and the Deepgram path are untouched, the live-segments forward carries no language field). Russian is the first language; the structure takes more (`languages.ts` holds one pack per language).

**What it does when ON.** The assistant answers in the language the question was asked in, as long as that language has a pack and a voice and is listed in `MEETING_ASSISTANT_LANGUAGES` (default `ru`). Wake phrase: "Meeting Mind" always works; the Russian pack adds Cyrillic spellings of it ("Митинг Майнд" and speech-to-text variants). "Митинг" alone never wakes it (it is an ordinary word); the split "мит инг" may. Stop words, the cue, the apology, the limit line and the join intro come from the pack. A question in a language that is clearly not supported gets one spoken English line per meeting ("Sorry, I can only answer in English and Russian for now.") and no model call. When the language is not clear (short text, no agreeing tag), it behaves as the English assistant always has.

**Which language.** Cyrillic text decides by itself when long enough; otherwise the language tag on the live-stt segment, a rolling vote over the last ten finals of the meeting, and the meeting language from settings are combined. A lone mis-tag on a short English line never produces a "not supported" reply.

**Transcript source (important).** Recall's real-time transcript is English only, and in accuracy mode arrives minutes late, so a non-English meeting needs a live-stt stream:
- Soniox primary (`LIVE_STT_PROVIDER=soniox` or the user's selection): the bot is created with the intro but no Recall assistant endpoint, the assistant listens to the stored live-stt finals (no `VOICE_ASSISTANT_WAKE_SOURCE` change needed). There are no Recall partials, so barge-in comes from live-stt finals only.
- Shadow stream: needs `VOICE_ASSISTANT_WAKE_SOURCE=live_stt`, otherwise a non-English meeting gets no assistant.
- Recall-only bot with a non-English meeting language: no assistant (logged). With the language `auto` or English the bot is exactly as before. With `auto` the join intro stays English.
- A Soniox-primary bot that falls back to Recall's transcript goes silent for non-English meetings (the live finals are hidden then and there is no Recall endpoint).

**Speech.** Non-English answers use the ReadAloud route (`POST /v1/text-to-speech/{voice}?output_format=mp3_44100_128`, `Authorization: Bearer $READALOUD_API_KEY`, body `{text, language_code[, normalize]}`; `READALOUD_API_URL` overrides the base). It is not streaming, so an answer is cut into pieces of at most 170 characters at sentence or clause edges, at most 2 requests are in flight for the whole process, and the MP3s are joined in order. 502/503 are retried once. 402 means no credits: the provider is not called again for 10 minutes. No key is the same kind of failure. In both cases the assistant is silent in that language, logs one typed `tts_unavailable` line per language and meeting, and records `failed` with `detail` `no_credits` / `no_key`. There is an optional text-fallback hook in the session, but nothing in `RecallService` posts to chat, so production leaves it unwired.

**Numbers.** The model is told to spell numbers as words and keep names verbatim, and a post-check spells or strips any digit run before speech (Russian: dates, times, percent, currency, decimals, long digit strings read digit by digit). The provider's own normalisation (`normalize: "numbers"`) is sent only for de, fr, it, es (measured 2026-11-14); never for en, ja, ru (ru measured worse with it), and pt is on hold. Override with `MEETING_ASSISTANT_TTS_NORMALIZE` (`de=numbers,ru=none`). Known engine limits: OTP-like codes are read as one big number in es/fr/it/pt, percent decimals lose the decimal without normalisation in de/fr/it/pt/ru, ordinals are only right in English.

**Echo.** The bot's own Russian answer heard back is recognised across scripts (Unicode tokens, stem and transliteration matching), and the answer text has the wake phrase removed before it is spoken so it cannot wake itself. Pure Latin text still goes to the original `wake.ts` functions.

**Flags** (read at call time): `MEETING_ASSISTANT_MULTILINGUAL`, `MEETING_ASSISTANT_LANGUAGES` (default `ru`), `MEETING_ASSISTANT_TTS_VOICES` (`ru=aria`), `MEETING_ASSISTANT_WAKE_PHRASES` (JSON `{"ru":["..."]}` extra phrases), `MEETING_ASSISTANT_TTS_USD_PER_1K_CHARS` (default 0.01), `MEETING_ASSISTANT_TTS_NORMALIZE`, plus the secret `READALOUD_API_KEY`.

**Enabling.** Set `READALOUD_API_KEY`, then `MEETING_ASSISTANT_MULTILINGUAL=1`, for a user or meeting that has a live-stt stream and a meeting language set to Russian. Rollback: unset the flag (or `VOICE_ASSISTANT_KILL=1`, which silences everything).

**Cost per answer.** Same model cost as English (about $0.006 to $0.012) plus speech: characters x `MEETING_ASSISTANT_TTS_USD_PER_1K_CHARS`. At the default 0.01 per 1,000 characters a 200-character Russian answer is about $0.002 (the 0.01 is a list-price estimate for the higher tier, not a measured bill: check the real price). Fixed lines are rendered once per process. This is an estimate, not a bill.

**Events.** No new event types (migration 029 restricts them). The language goes in `detail` on `answered`; `failed` carries `detail` `no_credits` / `no_key`. `language_unsupported` and `tts_unavailable` are log lines only (`"event":"voice_assistant_ml"`, no text).

**Not verified.** No live meeting has been run in Russian. The Russian lines and wake spellings are machine-written and need a native check before the language is announced. Real Soniox language tags on short Russian segments, how the ReadAloud voice pronounces the brand name in the intro, and Recall's playback of the joined MP3 are untested here.

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
