# MeetingMind iOS — ASA Launch Plan ($1K/mo)

Status: paused-and-staged. Flip ON the moment 6.1.3 (with SKAdNetwork fix +
email capture) is APPROVED. Do **not** spend on 6.1.2 — Apple Search Ads
identifier `cstr6suwn9` is missing and you will reproduce the May 2026 zero-
attribution failure.

## Budget split (US first, expand after 14 days of data)

| Bucket                | Daily   | Monthly | Match type | Why                                      |
|-----------------------|---------|---------|-----------|------------------------------------------|
| Brand defense         | $4/d    | ~$120   | Exact     | Cheap CPT, blocks Otter/Fireflies poach  |
| Competitor defense    | $12/d   | ~$360   | Exact     | Buy intent already there; high CPT but high LTV |
| Generic (high-intent) | $10/d   | ~$300   | Exact + Broad | Discover converting terms              |
| Search Match (probe)  | $4/d    | ~$120   | Search Match | Apple's own broad — cheap discovery   |
| Today/Search tab      | $3/d    | ~$90    | n/a       | Browse-intent volume booster              |
| **Total**             | **$33/d** | **~$990** |       |                                          |

Daily budget cap in `asa_product_configs` already bumped to $25 — that's the
*per-campaign* cap our optimizer enforces; ASA campaigns themselves are
budgeted above.

## Keywords

### A. Brand defense — Exact, all geos (US/CA/UK/AU first)

```
meeting mind
meetingmind
meeting mind app
meeting mind ai
```

### B. Competitor defense — Exact, US/CA/UK/AU

Apple allows *bidding* on competitor brand keywords (just not naming them in
your creative). High CPT but the intent is pre-qualified.

```
otter
otter ai
otter.ai
otter app
fireflies
fireflies ai
fireflies.ai
granola
granola ai
granola notes
krisp
krisp ai
fathom
fathom ai
fathom note
tldv
tl;dv
notta
notta ai
tactiq
read ai
read.ai
supernormal
fellow app
sembly
sembly ai
```

### C. Generic high-intent — Exact + Broad

```
meeting transcription
meeting transcriber
meeting recorder
meeting notes
meeting notes ai
ai meeting notes
ai meeting assistant
ai notetaker
ai note taker
meeting summary
meeting summary ai
record meeting
record meeting iphone
zoom transcription
zoom recorder
teams transcription
google meet transcription
auto transcribe meeting
transcribe meeting
transcribe call
transcribe audio
voice transcription
voice to text ai
speech to text app
interview transcription
lecture transcription
1 on 1 notes
sales call recorder
sales call transcription
phone call recorder
record phone call
call recorder iphone
call recorder app
record phone calls iphone
call transcription
call notes ai
call summary
```

### D. Negatives (apply at campaign level)

```
free
crack
mod
hindi songs
prank
ringtones
```

## Custom Product Pages (CPP) — 3 variants

Apple Review will reject any screenshot/copy that names competitors. The
variants below differentiate by *use case*, not by competitive comparison.

### CPP-A: Phone Calls (the differentiator)

> Most "meeting AI" tools only handle Zoom/Meet/Teams. MeetingMind also
> records, transcribes, and summarizes **phone calls**. Sales calls, 1:1s,
> customer interviews — all in one place.

Screenshot stack:
1. Hero: "Record any call — meeting or phone"
2. Live transcription mid-call
3. AI summary + action items
4. Ask follow-up questions ("what did they commit to?")
5. Searchable history

### CPP-B: Sales Persona

> Stop typing follow-up notes after every call. MeetingMind records, transcribes,
> and pulls action items so you can be present on the call and ship the recap
> in one tap.

Screenshot stack:
1. Hero: "Be present on the call. Ship the recap in one tap."
2. Live transcript
3. Action items extracted with assignees
4. CRM-ready summary
5. Searchable account history

### CPP-C: Affordability ("indie price")

> Premium meeting AI without the enterprise price tag. Unlimited recordings,
> AI summaries, action items, Q&A — one fair monthly price.

Screenshot stack:
1. Hero: "Premium meeting AI, indie price"
2. Feature list (recording / transcript / summary / Q&A / phone calls)
3. Pricing card with proof points
4. Reviews/social proof
5. Try free → upgrade flow

## CPP assignments

| Campaign            | CPP   | Why                                           |
|---------------------|-------|-----------------------------------------------|
| Brand defense       | default page | brand searchers know us                |
| Competitor defense  | CPP-A (phone calls) | the real wedge vs Otter/Fireflies |
| Generic high-intent | CPP-B (sales)       | searcher has a job, sell it       |
| Search Match probe  | CPP-C (price)       | budget-conscious discovery        |

## App Store metadata tweaks (no version bump needed)

Subtitle/Promo Text can be edited without a new submission — change after
6.1.3 approves so impressions land on refreshed copy.

Suggested subtitle (29 char cap):
- A: "AI Notes for Meetings & Calls" (29) ← recommended
- B: "Record. Transcribe. Summarize."  (30 — too long, trim)
- C: "AI Meetings + Phone Call Notes" (30 — too long)

Suggested promo text (170 char cap):
> Record any meeting or phone call. Get instant AI transcription, smart
> summaries, action items, and answers to your follow-up questions. All
> in one place.

## Tracking we'll have after 6.1.3 ships

- SKAdNetwork conversion rate per campaign (now wired)
- Email captured % per campaign (drip nurture pool for non-converters)
- Paywall view → purchase per campaign (via PaywallKit `placement` filter)
- 7d retention proxy (RatingKit `app_open` events bucketed by install date)

## Loops / Resend drip (email captures, non-converters)

3-touch sequence, fires from server when `email_captured` event has no
`purchase` within 24h:

- T+24h: "Did you try recording your first meeting? Here's a 30s walkthrough."
- T+72h: "60% off your first month — use this link in the app." (promo code:
  `START30`)
- T+7d: "Final reminder — code expires tomorrow."

## When to enable

1. 6.1.3 status = READY FOR SALE (Apple email + ASC dashboard)
2. Verify on a fresh device that build is downloadable (`itunes.apple.com/lookup?id=6757317991` returns version 6.1.3)
3. Flip the 5 ASA campaigns ENABLED (US)
4. Watch the first 48h: CPT, tap-through, conversion to first paywall view
5. Day 7: if any single keyword is >2x CPT vs the bucket average and converting <50% of the bucket rate, pause it
6. Day 14: expand winners to CA/UK/AU

## Kill criteria

- Total spend $1K with <8 install→purchase conversions across all campaigns → pause everything, fix funnel before retrying
- Brand defense CPT > $3 → someone else (Otter/Fireflies) is bidding on us; raise to defend or accept the leakage
- Competitor terms CPT > $8 with conversion < 5% → pause competitor bucket, redeploy to generic

## What's NOT in this plan (intentionally)

- Don't bid on "free meeting recorder" / "free call recorder" — bargain hunters never convert at our price point
- Don't run Display Today/Search tab >$5/d until SKAN data shows generic search is working — Display burns money on browse-intent without proven funnel
- Don't expand to non-English markets until US ROAS clears 0.5 by day 14
