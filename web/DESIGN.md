# MeetingMind web: design plan

Identity: **the well-kept minute book.** A meeting product's job is to turn a room of voices into a record someone trusts. The interface borrows from that world: voices as colored ribbons, the reading text of the record set like minutes (serif, generous leading), the pen marks of whoever reviews them (a yellow highlighter for what is playing or decided, a blue margin pen for actions).

## 1. Research learnings (public marketing pages and docs; help-center pages were mostly 403 or thin)

Sources fetched: granola.ai, fireflies.ai, read.ai homepages; fathom.ai redirect; a comparison roundup. Otter's help center blocked fetch, so Otter notes come from general knowledge and the roundup, flagged as lower confidence.

1. Granola: the notes pane is the product. User notes sit beside AI-enhanced notes with a "My notes / Enhanced" switch; chat sits under it with suggested prompts ("List actions", "Write follow-up email"). Adopt: summary and chat as peers of the transcript, suggested prompts in chat.
2. Granola: private by default, explicit "Share notes" menu. Adopt: share is one visible control in the header, state shown plainly.
3. Granola tone is quiet: whitespace, short headlines, product shots do the explaining. Adopt for landing: one honest product picture, little copy.
4. Fireflies: summary views switch between Overview, Bullet points, Action items, Custom notes; plus topic trackers, soundbites, comments, bookmarks. Adopt: our template picker is the equivalent; keep action items a first-class block, not buried.
5. Fireflies: talk-time per speaker and a sentiment/topic layer are "conversation intelligence". Avoid: dashboard-of-gauges. Adopt: one talk-time ribbon per meeting.
6. Fireflies landing is a very long feature catalogue (15+ sections, SOC2/GDPR badge rows, 1M+ logos). Avoid: logo walls and badge rows we cannot back with real numbers.
7. Read.ai: flow framed as prepare, capture, act ("Meetings in, decisions out"). Adopt: landing narrative in that order, using plain words.
8. Read.ai and Fathom both push action items out to other tools. Adopt: action items get "add to todos" in place (already exists).
9. Fathom (via roundup): highlights, action items and decisions are generated automatically and are the first thing shown; transcript is secondary. Adopt: on the recording detail, the record (summary) leads when it exists; the transcript is the long-form appendix.
10. Otter (lower confidence): transcript with speaker labels and timestamps, playback bar pinned at the bottom, chat in a side pane. Adopt: pinned player (we have it), speaker timeline above the transcript.
11. Common failure across the category: dense toolbars and PRO badges on every tab. Avoid: keep one upgrade note; gate lightly.
12. Empty states in this category are a sad icon in a circle plus a button. Avoid: say what will appear and how it arrives (record, upload, join a call).
13. Onboarding in these apps is calendar-connect first. We keep that in Meetings and settings; do not add a modal tour.
14. Every competitor's recordings home is a card grid or flat table sorted by date. Adopt: grouped by date; Avoid: the identical card grid. We use a ledger of rows where each row carries its own voice ribbon.

## 2. Tokens

Named palette. HSL channels live in `globals.css`; Tailwind names are unchanged (`background`, `foreground`, `primary`, ...), plus `mark`, `warning`.

| Name | Role | Light | Dark |
|---|---|---|---|
| paper | page background | `#F2F4F7` | `#0F141B` |
| surface | cards, sidebar | `#FFFFFF` | `#171E27` |
| ink | text | `#16212E` | `#E8EDF3` |
| signal | primary actions, links, focus ring (the margin pen) | `#2D4ACB` | `#9FB1FF` |
| mark | highlighter: the playing line, upgrade note, caution | `#FBE9A0` | `#4F4310` |
| quiet | muted text | `#4A5667` | `#9AA7B8` |

Voice colors (shared with Android, `lib/utils/speakers.ts`): `#4A4DCB #0B7A75 #B4501A #8E3A9E #2B6CB0 #A33A5B #4D7C0F #6B5B95`. They appear only where a person speaks: ribbons, transcript avatars, talk-time.

Contrast (measured): ink/paper 14.8 and 15.7; quiet/paper 6.8 and 7.6; white on signal 7.1; dark paper on dark signal 9.0; ink on mark 13.4 and 8.3; destructive 6.0 / 6.7; success 5.9 / 8.3. Input borders 3:1 or better.

Type. Two families, clearly different:
- **Schibsted Grotesk** (UI, headings, numbers): 600 for headings, tight tracking at display sizes.
- **Newsreader** (the record: summary text, transcript text, landing minute mock): optical sizing on, 17px / 1.75, measure capped at 68ch.
Scale: 12 / 14 / 16 / 18 / 24 / 32 / 44-56 (landing hero only). Timestamps and stats use `tabular-nums` of the grotesk; no monospace.

Shape and depth: 8px radius, 1px borders, no shadows, no gradients. Surfaces separate by value (paper vs surface), not by lift.

Motion: one orchestrated moment, the landing hero ribbon drawing in once. Hover color transitions only. `prefers-reduced-motion` zeroes everything.

## 3. Layout

Shell: 240px sidebar on md and up; below md a 56px top bar with a menu button opens the sidebar as a drawer (Escape and scrim close it). Active item: tinted fill plus a 3px signal bar on the left edge.

Recordings home (a ledger, not a card grid):

```
Recordings                                   [Search] [New recording]
12 recordings                                         2/3 free used

 Last 7 days:   9 meetings   6.5 h recorded   14 action items
 [filters.......................................................]

 Today
 09:30  Weekly product sync                       42 min  3,104 words
        [=====Ana=====][==Ben==][=Ana=][==Cy==]   Completed
 Yesterday
 16:10  Customer call: Acme                       18 min  1,020 words
        [==========Dee==========][===Eli===]      Completed
```
Each row is one link; the left column is the date group's gutter on wide screens (margin note), stacked on mobile. The ribbon is the row's signature; rows without speaker data show a plain quiet rule.

Recording detail (the minute):

```
< Recordings
Weekly product sync   [Completed] [star]        [Export] [Share]
Tue 12 Oct   42 min   3,104 words   English       tags / folder
[=====Ana=====][==Ben==][=Ana=][==Cy==]  <- speaker timeline, click to seek
---------------------------------------------------------------
 Record | Transcript | Q&A                (tabs)
 +-----------------------------------+ +-------------------+
 | Summary (serif, 68ch)             | | Talk time         |
 | Key points                        | | Action items      |
 | Action items                      | | Template          |
 | Topics                            | |                   |
 +-----------------------------------+ +-------------------+
 [ pinned audio player ]
```
Transcript: speaker name and timestamp in the grotesk in a left gutter, text in the serif; the playing segment gets the highlighter fill. Tab order stays transcript / summary / qa, default transcript (existing behavior kept).

Landing: one headline, a hero that is a drawn minute (ribbon above a short serif minute with a highlighted decision), then three plain sections in the order prepare / capture / act, pricing note, footer. Light and dark follow the OS.

Auth: a plain two-part page, ribbon mark, one sentence, Google button.

## 4. Principles

1. The record is serif; the tool is grotesk.
2. Color means a person is speaking, or a pen touched it. Nothing else is decorated.
3. Quiet everywhere except one place: the voice ribbon.
4. Rows and rules over floating cards; no shadows.
5. Every interactive element has a visible focus ring and a 44px target.

## 5. Self-critique against the generic list, and what changed

- Cream + high-contrast serif + terracotta? No: paper is a cool blue-gray, accent is a blue pen. But Newsreader plus a warm-yellow highlighter risks reading as "editorial". Revision: the serif is limited to the record text (summary, transcript, the landing mock); headings, nav and numbers are grotesk, and the highlighter appears only on state (playing, upgrade, caution), never as a decorative wash.
- Near-black + single acid accent? Dark mode is blue-slate with a periwinkle signal, not black plus neon. Kept.
- Hairline-rule broadsheet? First draft leaned on rules between every row. Revision: group gutters and spacing carry structure; rules only under the detail header and the sidebar.
- Identical rounded cards with soft shadow, gradients? Removed shadows and gradients; recordings are rows with ribbons; the only card surface left is functional (stats, panels) at 8px with a border.
- Tracked-out ALL-CAPS eyebrows? Removed from date groups and the weekly stats label (they were uppercase tracking-wide); they are now plain sentence-case headings.
- Middle-dot meta strings? Removed from talk-time and cards; metadata is separate labelled fields.
- "WORD: fragment" labels, monospace small labels, arrows on every link? None used.
- Accent on one word in a headline? No. Numbered sections? No; the landing three steps are a real sequence (prepare, capture, act) and are labelled by name, not by numeral.
- Motion: only the hero ribbon, once, disabled under reduced motion.
- Boldness spent in one place: the voice ribbon (row signature, detail timeline, hero, brand mark). Weakest point of the plan: the brand mark and the ribbon are the same idea repeated four times, which risks becoming a motif gimmick. Mitigation: the ribbon is always data-driven where real data exists; on landing it is clearly illustrative.
