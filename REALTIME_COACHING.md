# Real-Time AI Coaching — Architecture & Monetization

**Status:** Phase 1 design, not yet implemented (2026-06-12).
**Sibling docs:** [ARCHITECTURE.md](./ARCHITECTURE.md), [BACKEND_API.md](./BACKEND_API.md), [DATA_MODELS.md](./DATA_MODELS.md), [PROCESSING_PIPELINE.md](./PROCESSING_PIPELINE.md).

A specialist AI agent (Phase 1: **Sales Discovery**) watches a live meeting transcript and pushes actionable insights to a side panel in real time. Monetized as a **consumable IAP per session** — pay only when the coach is on, so heavy users never break our unit economics.

---

## Why per-meeting, not a Pro tier

| Model                          | Light user (2/mo) | Heavy user (30/mo) | Risk                  |
| ------------------------------ | ----------------- | ------------------ | --------------------- |
| Flat $15/mo Pro                | +$14 margin       | **−$5 margin**     | Catastrophic tail risk |
| Per-session $1.99–0.80         | +$1 margin        | +$20+ margin       | None — always positive |
| Capped subscription $24.99/mo  | +$24              | +$9 (50-session cap throttles) | Soft cap, manageable  |

Per-session aligns cost to revenue 1:1. Capped subscription is offered for the rare power user who hates thinking about credits.

The decision-at-purchase rule: **the user picks "AI Coach: ON" before recording starts**, with credit balance visible. **Never** prompt mid-meeting.

---

## Cost math (Sonnet 4.6 + prompt caching)

- System prompt: ~400 tokens — **fully cached**
- Rolling 5-min transcript window: ~700 tokens — 90% cache hit as it slides
- Output: ~150 tokens per call
- Cadence: 1 call every 30s

| Per …            | Tokens (uncached eq.) | Cost (USD)  |
| ---------------- | --------------------- | ----------- |
| 30s call         | ~150 in + 150 out     | ~$0.003     |
| 60-min meeting   | ~120 calls            | **~$0.36**  |

At $0.99 / session price → **~64% gross margin** on the cheapest credit pack.

---

## IAP product definitions

Set these up in **App Store Connect** and **Play Console** before shipping Phase 1.

### Consumables (one-time, restorable on Google Play, non-restorable on Apple)

| Product ID                | Display title              | Price (USD) | Credits | Effective $/session |
| ------------------------- | -------------------------- | ----------- | ------- | ------------------- |
| `mm_coach_pack_5`         | 5 Coaching Sessions        | $9.99       | 5       | $2.00               |
| `mm_coach_pack_25`        | 25 Coaching Sessions       | $29.99      | 25      | $1.20               |
| `mm_coach_pack_100`       | 100 Coaching Sessions      | $79.99      | 100     | $0.80               |

### Subscription (auto-renewing, monthly, capped)

| Product ID                  | Display title                | Price (USD) | Period  | Cap                                    |
| --------------------------- | ---------------------------- | ----------- | ------- | -------------------------------------- |
| `mm_coach_unlimited_monthly` | AI Coach — Unlimited Monthly | $24.99      | 1 month | 50 sessions/mo soft cap, then throttled |

Throttle behavior at cap: next session warning + 1-hour cooldown between sessions until the month rolls over.

### Free trial

- **2 free sessions** per user (lifetime, not monthly). Granted on first tap of "Enable AI Coach". Stored as a `coaching_credits` row with `source='free'`.
- No credit card needed. This is the activation hook.

---

## Backend changes (`ai-notetaker-backend` on Fly)

### New Postgres tables

```sql
CREATE TABLE coaching_credits (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source       TEXT NOT NULL CHECK (source IN ('free','iap','subscription')),
  product_id   TEXT,            -- IAP product, NULL for free + subscription
  balance      INTEGER NOT NULL CHECK (balance >= 0),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ      -- subscription credits roll over monthly; consumables never expire
);

CREATE TABLE coaching_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  persona      TEXT NOT NULL,   -- 'sales_discovery', 'research', etc.
  credit_id    UUID REFERENCES coaching_credits(id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  insight_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE coaching_insights (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES coaching_sessions(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,   -- 'question','objection','signal','gap'
  text         TEXT NOT NULL,
  urgency      TEXT NOT NULL,   -- 'now','soon','before-end'
  transcript_offset_seconds INTEGER, -- position in meeting at time of emit
  emitted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### New routes

| Method  | Path                                  | Notes                                           |
| ------- | ------------------------------------- | ----------------------------------------------- |
| GET     | `/coaching/credits`                   | Current balance grouped by source               |
| POST    | `/coaching/sessions`                  | Body: `{recordingId, persona}`. Debits 1 credit. Returns `{sessionId}`. 402 if no credits. |
| GET     | `/coaching/sessions/:id/stream`       | SSE — emits insights as Claude returns them     |
| POST    | `/coaching/sessions/:id/end`          | Flushes buffer, marks session ended             |
| GET     | `/coaching/sessions/:id/insights`     | Post-meeting full list for the summary view     |
| POST    | `/iap/coaching/verify`                | Server-side verification of Apple/Google receipt, grants credits |

### Insight generator loop

```js
// Pseudo — runs per active session
async function tick(sessionId) {
  const buffer = await getRollingTranscript(sessionId, { lastMinutes: 5 });
  if (buffer.length < MIN_TOKENS) return; // nothing new

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: [{ type: 'text', text: PERSONA[persona].system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: `Transcript so far:\n${buffer}\n\nReturn JSON only.` }],
  });

  const { insights } = JSON.parse(extractJson(resp.content[0].text));
  for (const i of insights) {
    await db.insert('coaching_insights', { sessionId, ...i });
    sseEmit(sessionId, i);
  }
}

setInterval(() => activeSessions.forEach(tick), 30_000);
```

### Sales Discovery persona

```js
const SALES_DISCOVERY = {
  key: 'sales_discovery',
  displayName: 'Sales Discovery',
  description: 'Coaches the seller through BANT/MEDDIC discovery in real time.',
  system: `You are an expert sales coach watching a live discovery call. Your job: spot tactical opportunities the seller is missing AND tell them in 120 chars or less.

Watch for:
- Discovery questions the seller should ask next (budget, timeline, decision-maker, current solution, pain magnitude)
- Buying signals (urgency words, comparison shopping, internal advocates) the seller should mine deeper
- Objections raised but not addressed
- Mismatch between prospect needs and what the seller is pitching

OUTPUT FORMAT (JSON only, no commentary):
{ "insights": [
  { "type": "question" | "objection" | "signal" | "gap",
    "text": "<actionable suggestion, ≤120 chars>",
    "urgency": "now" | "soon" | "before-end" }
] }

If nothing new since the last call, return { "insights": [] }. Do NOT repeat suggestions already raised in this session.`,
  cadenceSeconds: 30,
  windowMinutes: 5,
};
```

---

## Client UX

### Pre-meeting (start-recording screen)

```
┌─────────────────────────────────────┐
│  Title:  [Discovery call w/ Acme]   │
│                                     │
│  ┌─────────────────────────────┐    │
│  │  💡 AI Coach                 │    │
│  │  Persona: Sales Discovery ▼ │    │
│  │  Credits: 3 sessions         │    │
│  │  ☐ Enable for this meeting  │    │
│  └─────────────────────────────┘    │
│                                     │
│  [● Start Recording]                │
└─────────────────────────────────────┘
```

- Persona dropdown is single-option in Phase 1.
- Tapping "Enable" with 0 credits opens the IAP sheet.
- "Get more credits" link from the panel anytime.

### Mid-meeting (collapsible side panel)

```
┌─────────────────────────────────┐
│  💡 Coach            [collapse] │
├─────────────────────────────────┤
│  0:42  🟡 Ask about budget      │
│        — they mentioned "$5K"   │
│                                 │
│  1:18  🟢 Strong signal: perf    │
│        — dig into latency req   │
│                                 │
│  2:03  🔴 Objection: "expensive" │
│        — anchor on cost-of-     │
│        delay before discounting │
└─────────────────────────────────┘
```

Urgency color: 🔴 now → 🟡 soon → 🟢 before-end. New insights animate in.

### Post-meeting (recording detail view, new section)

A "Coaching Insights" section above the transcript:
- Bullet list of every insight emitted, grouped by urgency
- Filterable by type (question / objection / signal / gap)
- Included automatically in shared exports (Share → PDF/Text already exists)

---

## Implementation phases

### Phase 1 — 3 weeks, iOS only

- [ ] Backend: 3 new tables, 6 routes, IAP receipt verification
- [ ] Backend: insight-generator loop, Sales Discovery persona, SSE plumbing
- [ ] iOS: pre-meeting "AI Coach" toggle on start-recording screen
- [ ] iOS: IAP integration for 3 consumable packs + 1 subscription via existing PaywallKit
- [ ] iOS: side panel during recording (SSE consumer)
- [ ] iOS: post-meeting Coaching Insights section
- [ ] Marketing: in-app promo card linking to /coaching when user records meeting #2+

### Phase 2 — 2 weeks

- [ ] Android: full parity (everything iOS already has)
- [ ] Add 2 more personas: Research Interview, Hiring Interview
- [ ] Persona picker on the start screen

### Phase 3 — 2 weeks

- [ ] 5 more personas: Therapy/Coaching, Customer Support, Negotiation, Education, Manager 1:1
- [ ] "Insights summary" auto-included in shared exports
- [ ] Persona learning — per-user adjustments based on dismissed/acted-on insights

---

## What we are NOT doing in Phase 1

- **No "whisper through AirPods"** — high consent/legal risk, save for later behind a clear disclosure UX
- **No multi-persona simultaneous coaching** — one persona per session
- **No on-device insight generation** — server-side only, simpler to iterate
- **No live participation detection (who's speaking)** — the agent uses transcript text only, doesn't need speaker attribution to be useful for Phase 1
- **No team/enterprise tier** — pure B2C consumable, can layer team plans later

---

## Open questions to resolve before coding

1. **Refund policy** — Apple lets users request refunds on consumables. Do we refund used credits or only unused? Recommendation: only unused.
2. **Subscription cap mechanics** — soft (warn + throttle) or hard (block)? Recommendation: soft, but log + flag heavy users >100 sessions/mo manually.
3. **What happens if Claude fails mid-session?** — pause the session, don't charge for it. Refund logic: if `insight_count < 3` at end, auto-refund the credit.
4. **Server-side rate limiting** — what's the max concurrent active coaching sessions per user? Recommendation: 1 (one meeting at a time).
