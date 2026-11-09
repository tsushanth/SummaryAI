-- Migration: 029_voice_assistant_events.sql
-- In-meeting voice assistant metrics (docs/VOICE_ASSISTANT.md). NOT applied by the PR that adds it.
--
-- One row per event. By design there is NO question text, answer text, transcript text, speaker name or meeting title here:
-- only ids, counts, durations and cost estimates. The backend works without this table (it detects its absence once and keeps
-- counters in memory + logs), so applying it is an improvement for restart-proof caps and the multi-day roll-up, not a prerequisite.
--
-- Access: service role only. RLS is on and there are deliberately NO policies and NO grants for anon/authenticated.

create table if not exists voice_assistant_events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  event         text not null check (event in (
    'wake','question','answered','failed','barge_in','stale_dropped','echo_suppressed','cap_hit','history_denied','intro','cue'
  )),
  user_id       uuid references auth.users(id) on delete cascade,
  meeting_id    uuid references meetings(id) on delete set null,
  ttfa_ms       integer,   -- end of question -> first audio accepted by Recall
  answer_ms     integer,   -- end of question -> answer audio accepted by Recall
  llm_ms        integer,
  tts_ms        integer,
  llm_usd       numeric(10,6),
  tts_usd       numeric(10,6),
  found         boolean,   -- false = "no answer found"
  owner_speaker boolean,   -- speaker was allowed to use past meetings
  tools         integer,
  chars         integer,
  failure       text check (failure is null or failure in ('llm','tts','play','timeout','internal')),
  detail        text       -- short stable code only (barge_in phase, cap kind, stale reason)
);

create index if not exists voice_assistant_events_created_idx on voice_assistant_events (created_at desc);
create index if not exists voice_assistant_events_user_day_idx on voice_assistant_events (user_id, created_at desc) where event = 'question';

alter table voice_assistant_events enable row level security;
revoke all on voice_assistant_events from anon, authenticated;
-- Service role bypasses RLS; no policy is created on purpose.

-- Roll-up the owner can run by hand (the backend also serves it: GET /internal/voice-assistant/rollup):
--   select date_trunc('day', created_at) as day,
--          count(*) filter (where event = 'wake')                        as wake_detections,
--          count(*) filter (where event = 'question')                    as questions,
--          count(*) filter (where event = 'answered')                    as answered,
--          count(*) filter (where event = 'answered' and found = false)  as no_answer_found,
--          count(*) filter (where event = 'failed')                      as failures,
--          count(*) filter (where event = 'barge_in')                    as barge_ins,
--          percentile_cont(0.5)  within group (order by ttfa_ms)   filter (where event = 'answered') as ttfa_p50_ms,
--          percentile_cont(0.95) within group (order by ttfa_ms)   filter (where event = 'answered') as ttfa_p95_ms,
--          sum(coalesce(llm_usd,0) + coalesce(tts_usd,0))                as cost_usd
--   from voice_assistant_events group by 1 order by 1 desc;
