# Summary AI - UX Design Document

## Navigation Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TabView (3 tabs)                               │
├─────────────────────┬─────────────────────────┬─────────────────────────────┤
│                     │                         │                             │
│   Recordings Tab    │      Search Tab         │      Settings Tab           │
│   (NavigationStack) │   (NavigationStack)     │    (NavigationStack)        │
│                     │                         │                             │
│   ┌─────────────┐   │   ┌─────────────────┐   │   ┌─────────────────────┐   │
│   │ Recordings  │   │   │  Search View    │   │   │   Settings List     │   │
│   │    List     │   │   │                 │   │   │                     │   │
│   └──────┬──────┘   │   └────────┬────────┘   │   └──────────┬──────────┘   │
│          │          │            │            │              │              │
│          ▼          │            ▼            │              ▼              │
│   ┌─────────────┐   │   ┌─────────────────┐   │   ┌─────────────────────┐   │
│   │  Recording  │   │   │ Recording Detail│   │   │   Profile View      │   │
│   │   Detail    │   │   │ (from search)   │   │   │   Privacy View      │   │
│   └─────────────┘   │   └─────────────────┘   │   │   About View        │   │
│                     │                         │   └─────────────────────┘   │
└─────────────────────┴─────────────────────────┴─────────────────────────────┘

                    Floating Record Button (overlay on all tabs)
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │   Recording Sheet (fullscreen)│
                    │   presented modally           │
                    └───────────────────────────────┘
```

**Navigation Philosophy:**
- TabView for primary navigation between major sections
- NavigationStack within each tab for drill-down
- Recording presented as fullscreen modal (interrupts normal flow intentionally)
- Floating action button (FAB) for recording - always accessible

---

## Screen Inventory

### 1. Onboarding & Auth Screens

#### 1.1 Welcome Screen
**Purpose:** First launch, introduce app value proposition

**UI Elements:**
- App logo and name
- 3 carousel slides with illustrations:
  - "Record meetings with one tap"
  - "AI transcribes and summarizes"
  - "Search and ask questions"
- "Get Started" button
- "I already have an account" link

**Actions:**
- Get Started → Auth Choice Screen
- Already have account → Login Screen

---

#### 1.2 Auth Choice Screen
**Purpose:** Choose authentication method

**UI Elements:**
- "Continue with Magic Link" button (primary)
- "Continue with Email & Password" button (secondary)
- Divider with "or"
- Apple Sign In button (future consideration)
- Terms of Service and Privacy Policy links

**Actions:**
- Magic Link → Magic Link Entry Screen
- Email/Password → Registration Screen

---

#### 1.3 Magic Link Entry Screen
**Purpose:** Enter email for magic link

**UI Elements:**
- Email text field
- "Send Magic Link" button
- Back button
- Explanatory text: "We'll send you a secure link to sign in"

**Actions:**
- Send → Confirmation Screen (check your email)
- Deep link opens → Auto-login → Recordings List

---

#### 1.4 Login Screen
**Purpose:** Email/password login

**UI Elements:**
- Email text field
- Password text field (with show/hide toggle)
- "Log In" button
- "Forgot Password?" link
- "Create Account" link

**Actions:**
- Log In → Recordings List (on success)
- Forgot Password → Password Reset Flow
- Create Account → Registration Screen

---

### 2. Main App Screens

#### 2.1 Recordings List Screen (Home)
**Purpose:** Primary hub - view all recordings, access recording detail

**UI Elements:**
```
┌─────────────────────────────────────────┐
│ ◀ Recordings                    [Profile]│  ← Navigation bar
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 🔍 Search recordings...             │ │  ← Inline search (taps → Search tab)
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│                                         │
│ Today                                   │  ← Section header
│ ┌─────────────────────────────────────┐ │
│ │ 📝 Product Standup           12:34  │ │
│ │ ✓ Completed · 23 min · 3 speakers   │ │
│ └─────────────────────────────────────┘ │
│ ┌─────────────────────────────────────┐ │
│ │ 🔄 Client Call               10:15  │ │
│ │ ◐ Transcribing · 45 min             │ │  ← Shows processing status
│ └─────────────────────────────────────┘ │
│                                         │
│ Yesterday                               │
│ ┌─────────────────────────────────────┐ │
│ │ 📝 Team Retrospective        16:00  │ │
│ │ ✓ Completed · 58 min · 6 speakers   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│                 ...                     │
│                                         │
│              ┌───────┐                  │
│              │  ●    │                  │  ← Floating Record Button
│              │ START │                  │
│              └───────┘                  │
├─���───────────────────────────────────────┤
│    [🏠]           [🔍]          [⚙️]    │  ← Tab bar
│  Recordings      Search       Settings  │
└─────────────────────────────────────────┘
```

**Key Actions:**
- Tap recording → Recording Detail
- Tap search bar → Switch to Search tab
- Tap floating button → Start Recording (modal)
- Swipe left on row → Delete (with confirmation)
- Pull down → Refresh list
- Long press → Context menu (rename, delete, export)

**States:**
- Empty state: Illustration + "Record your first meeting"
- Loading: Skeleton rows
- Error: Retry button

---

#### 2.2 Recording Screen (Modal)
**Purpose:** Active recording interface

**UI Elements:**
```
┌─────────────────────────────────────────┐
│ [✕ Discard]                    [Pause ⏸]│  ← Top controls
├─────────────────────────────────────────┤
│                                         │
│                                         │
│              01:23:45                   │  ← Large timer
│                                         │
│         ════════════════════            │  ← Audio level visualization
│         ▁▂▃▅▇▅▃▂▁▂▄▆▇▆▄▂▁              │     (animated bars)
│         ════════════════════            │
│                                         │
│              🔴 Recording               │  ← Status indicator
│                                         │
│         "Recording in progress.         │
│          You can lock your screen       │
│          or switch apps."               │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│                                         │
│              ┌─────────┐                │
│              │  ■      │                │  ← Large stop button
│              │  STOP   │                │
│              └─────────┘                │
│                                         │
│         Tap to stop and save            │
│                                         │
└─────────────────────────────────────────┘
```

**Key Actions:**
- Stop → Save Recording Sheet (enter title)
- Pause → Pause recording (icon changes to resume)
- Discard → Confirmation alert → Back to list
- System interruption → Auto-pause with banner

**States:**
- Recording (animated indicator)
- Paused (different color, "Paused" label)
- Saving (after stop, brief upload indicator)

---

#### 2.3 Save Recording Sheet
**Purpose:** Name recording before upload

**UI Elements:**
```
┌─────────────────────────────────────────┐
│           Save Recording                │
├─────────────────────────────────────────┤
│                                         │
│  Duration: 23:45                        │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ Recording Title                     ││  ← Auto-suggested: "Recording"
│  │ Team Standup Meeting                ││     + date/time
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │         Save & Transcribe           ││  ← Primary action
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │           Save Only                 ││  ← Secondary (skip AI)
│  └─────────────────────────────────────┘│
│                                         │
└─────────────────────────────────────────┘
```

**Key Actions:**
- Save & Transcribe → Upload + queue processing → List with status
- Save Only → Upload only (can process later)

---

#### 2.4 Recording Detail Screen
**Purpose:** View transcript, summary, play audio, ask questions, export

**UI Elements:**
```
┌─────────────────────────────────────────┐
│ [< Back]  Team Standup      [···] [↗️]  │  ← Nav: more options, export
├─────────────────────────────────────────┤
│                                         │
│  Jan 15, 2026 · 23 min · 3 speakers     │  ← Metadata
│                                         │
├─────────────────────────────────────────┤
│  ▶  ━━━━━━━●━━━━━━━━━━━━━  12:34/23:00  │  ← Audio player (collapsible)
│     [⏪15]              [15⏩]  [1.0x]   │
├─────────────────────────────────────────┤
│                                         │
│  ┌────────┬────────┬────────┬────────┐  │
│  │Summary │Transcr.│Key Pts │  Q&A   │  │  ← Segmented control / tabs
│  └────────┴────────┴────────┴────────┘  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ │  [Content area changes based on     │ │
│ │   selected tab - see below]         │ │
│ │                                     │ │
│ │                                     │ │
│ │                                     │ │
│ │                                     │ │
│ │                                     │ │
│ │                                     │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

**Tab: Summary**
```
│  Summary                                │
│  ─────────────────────────────────────  │
│  The team discussed sprint progress,    │
│  focusing on the API refactor and       │
│  mobile app blockers. Three action      │
│  items were identified for follow-up.   │
│                                         │
│  Topics Discussed                       │
│  ┌──────────┐ ┌────────────┐ ┌───────┐  │
│  │ Sprint   │ │ API Design │ │Mobile │  │  ← Tappable topic chips
│  └──────────┘ └────────────┘ └───────┘  │
```

**Tab: Transcript**
```
│  🔍 Search in transcript...             │  ← Local search
│                                         │
│  ┌─ Speaker 1 ─────────────── 00:00 ─┐  │
│  │ Good morning everyone. Let's get  │  │  ← Tap timestamp to seek
│  │ started with the standup.         │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌─ Speaker 2 ─────────────── 00:15 ─┐  │
│  │ Sure. Yesterday I worked on the   │  │  ← Current segment highlighted
│  │ authentication flow and...        │  │     during playback
│  └───────────────────────────────────┘  │
│                                         │
│  ┌─ Speaker 1 ─────────────── 01:23 ─┐  │
│  │ Great progress. Any blockers?     │  │
│  └───────────────────────────────────┘  │
```

**Tab: Key Points**
```
│  Key Points                             │
│                                         │
│  • API refactor is 80% complete         │
│  • Mobile team blocked on auth endpoint │
│  • Design review scheduled for Friday   │
│                                         │
│  Action Items                           │
│                                         │
│  □ John to finish auth endpoint by Wed  │
│  □ Sarah to share design mockups        │
│  □ Team to review API docs              │
```

**Tab: Q&A**
```
│  ┌───────────────────────────────────┐  │
│  │ What were the main blockers       │  │  ← User question
│  │ discussed?                        │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ The main blocker discussed was    │  │  ← AI answer
│  │ the mobile team being blocked on  │  │
│  │ the authentication endpoint.      │  │
│  │                                   │  │
│  │ 📍 Referenced: 01:45, 05:23       │  │  ← Tappable citations
│  └───────────────────────────────────┘  │
│                                         │
│  ... previous Q&A ...                   │
│                                         │
├─────────────────────────────────────────┤
│  ┌─────────────────────────────┐ [Ask]  │  ← Input field (sticky bottom)
│  │ Ask a question...           │        │
│  └─────────────────────────────┘        │
```

**Key Actions:**
- Play/pause audio
- Skip forward/back 15s
- Change playback speed (0.5x, 1x, 1.25x, 1.5x, 2x)
- Tap timestamp → Seek audio
- Search transcript → Highlight matches
- Ask question → Send to AI
- Tap citation → Seek to that point
- Export (share sheet) → Choose format
- More menu → Rename, Delete, Reprocess

**States:**
- Processing: Show progress indicator per stage
- Failed: Show error with "Retry" button
- Partial: Can show transcript even if summary failed

---

#### 2.5 Search Screen
**Purpose:** Search across all recordings

**UI Elements:**
```
┌─────────────────────────────────────────┐
│ [Cancel]        Search                  │
├─────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ │
│ │ 🔍 Search recordings...             │ │  ← Auto-focused
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│                                         │
│ Recent Searches                         │  ← Before typing
│ ┌─────────────────────────────────────┐ │
│ │ 🕒 authentication                   │ │
│ │ 🕒 budget meeting                   │ │
│ │ 🕒 project timeline                 │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ─────────────────────────────────────── │
│                                         │
│ Results for "authentication"            │  ← After typing (3+ chars)
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Team Standup · Jan 15               │ │
│ │ "...working on the authentication   │ │  ← Context snippet
│ │ flow and ran into..."               │ │
│ │ 📍 01:45                            │ │  ← Timestamp badge
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Architecture Review · Jan 12        │ │
│ │ "...authentication should use       │ │
│ │ JWT tokens with..."                 │ │
│ │ 📍 12:30, 15:22                     │ │  ← Multiple matches
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

**Key Actions:**
- Type query → Live search (debounced)
- Tap result → Recording Detail, scrolled to match
- Tap timestamp → Recording Detail + seek audio
- Clear → Back to recent searches

---

#### 2.6 Settings Screen
**Purpose:** Account, preferences, privacy, help

**UI Elements:**
```
┌─────────────────────────────────────────┐
│           Settings                      │
├─────────────────────────────────────────┤
│                                         │
│  ACCOUNT                                │
│  ┌───────────────────────────────��─────┐│
│  │ 👤 john@example.com              > ││  ← Profile
│  ├─────────────────────────────────────┤│
│  │ 🔄 Sync Status: Up to date         ││
│  └─────────────────────────────────────┘│
│                                         │
│  RECORDING                              │
│  ┌─────────────────────────────────────┐│
│  │ Audio Quality          Standard  > ││
│  ├─────────────────────────────────────┤│
│  │ Auto-title with AI        [═══●]   ││  ← Toggle
│  └─────────────────────────────────────┘│
│                                         │
│  PRIVACY & DATA                         │
│  ┌─────────────────────────────────────┐│
│  │ Recording Consent Info           > ││
│  ├─────────────────────────────────────┤│
│  │ Data & Privacy                   > ││
│  ├─────────────────────────────────────┤│
│  │ Delete All Recordings            > ││  ← Destructive
│  └─────────────────────────────────────┘│
│                                         │
│  SUPPORT                                │
│  ┌─────────────────────────────────────┐│
│  │ Help Center                      > ││
│  ├─────────────────────────────────────┤│
│  │ Contact Support                  > ││
│  ├─────────────────────────────────────┤│
│  │ About Summary AI                 > ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │           Log Out                  ││  ← Destructive style
│  └─────────────────────────────────────┘│
│                                         │
│  Version 1.0.0 (42)                     │
│                                         │
└─────────────────────────────────────────┘
```

**Sub-screens:**
- Profile: Edit display name, change password
- Recording Consent Info: Legal info about recording
- Data & Privacy: What data we collect, retention, deletion
- Delete All Recordings: Confirmation flow

---

#### 2.7 Export Sheet
**Purpose:** Choose export format and share

**UI Elements:**
```
┌─────────────────────────────────────────┐
│           Export Recording              │
│              [✕ Close]                  │
├─────────────────────────────────────────┤
│                                         │
│  Choose what to include:                │
│                                         │
│  [✓] Summary                            │
│  [✓] Key Points                         │
│  [✓] Action Items                       │
│  [ ] Full Transcript                    │  ← Optional, can be long
│                                         │
│  Format:                                │
│  ┌──────────┐  ┌──────────┐            │
│  │   TXT    │  │   PDF    │            │  ← Segmented picker
│  │    ●     │  │          │            │
│  └──────────┘  └──────────┘            │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │           Generate Export          ││
│  └─────────────────────────────────────┘│
│                                         │
└─────────────────────────────────────────┘

        ↓ (after generation)

┌─────────────────────────────────────────┐
│          Share "Team Standup"           │
├─────────────────────────────────────────┤
│                                         │
│  [AirDrop] [Messages] [Mail] [Notes]    │  ← System share sheet
│                                         │
│  [Copy] [Save to Files] [More...]       │
│                                         │
└─────────────────────────────────────────┘
```

---

## 3. Consent & Privacy UX

### 3.1 First Recording Consent (One-time)

Shown when user taps record button for the first time:

```
┌─────────────────────────────────────────┐
│                                         │
│              🎙️                         │
│                                         │
│       Before You Record                 │
│                                         │
│  Summary AI records audio and uses AI   │
│  to transcribe and summarize content.   │
│                                         │
│  ⚠️  Important:                         │
│                                         │
│  • You are responsible for obtaining    │
│    consent from all participants        │
│    before recording.                    │
│                                         │
│  • Recording laws vary by location.     │
│    Some places require all-party        │
│    consent.                             │
│                                         │
│  • Recordings are processed by AI       │
│    services. Do not record sensitive    │
│    personal information.                │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │ [✓] I understand and will obtain   ││
│  │     consent before recording       ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │     I Understand, Continue         ││  ← Disabled until checked
│  └─────────────────────────────────────┘│
│                                         │
│       Learn more about recording laws   │  ← Link to help article
│                                         │
└─────────────────────────────────────────┘
```

### 3.2 Recording Indicator

When recording is active:
- iOS status bar shows orange microphone indicator (system-provided)
- App shows persistent banner if user navigates away:

```
┌─────────────────────────────────────────┐
│ 🔴 Recording in progress · 05:23  [View]│
└─────────────────────────────────────────┘
```

### 3.3 Settings - Recording Consent Info

```
┌─────────────────────────────────────────┐
│ [< Back]   Recording Consent            │
├─────────────────────────────────────────┤
│                                         │
│  Your Responsibilities                  │
│  ─────────────────────────────────────  │
│  When using Summary AI to record        │
│  conversations, you must:               │
│                                         │
│  1. Inform all participants that        │
│     the conversation is being recorded  │
│                                         │
│  2. Obtain their consent before         │
│     starting the recording              │
│                                         │
│  3. Comply with applicable recording    │
│     laws in your jurisdiction           │
│                                         │
│                                         │
│  Recording Laws                         │
│  ─────────────────────────────────────  │
│  Laws vary significantly:               │
│                                         │
│  • One-party consent: Only you need     │
│    to consent (e.g., most US states)    │
│                                         │
│  • All-party consent: Everyone must     │
│    consent (e.g., California, UK, EU)   │
│                                         │
│  We recommend always obtaining          │
│  explicit consent from all parties.     │
│                                         │
│                                         │
│  How Your Data Is Processed             │
│  ─────────────────────────────────────  │
│  • Audio is encrypted in transit        │
│  • Stored securely on our servers       │
│  • Processed by AI (Deepgram, Claude)   │
│  • You can delete recordings anytime    │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │       View Full Privacy Policy     ││
│  └─────────────────────────────────────┘│
│                                         │
└─────────────────────────────────────────┘
```

### 3.4 Data & Privacy Screen

```
┌─────────────────────────────────────────┐
│ [< Back]    Data & Privacy              │
├─────────────────────────────────────────┤
│                                         │
│  What We Collect                        │
│  ─────────────────────────────────────  │
│  • Email address (for account)          │
│  • Audio recordings you create          │
│  • Transcripts and summaries            │
│  • Questions you ask about recordings   │
│                                         │
│  How It's Used                          │
│  ─────────────────────────────────────  │
│  • Provide transcription service        │
│  • Generate AI summaries                │
│  • Answer your questions                │
│  • Sync across your devices             │
│                                         │
│  Third-Party Services                   │
│  ─────────────────────────────────────  │
│  • Deepgram (transcription)             │
│  • Anthropic Claude (AI summaries)      │
│  • Supabase (data storage)              │
│  • Google Cloud (hosting)               │
│                                         │
│  Your Rights                            │
│  ─────────────────────────────────────  │
│  • Download your data                   │
│  • Delete individual recordings         │
│  • Delete your entire account           │
│                                         │
│  ┌─────────────────────────────────────┐│
│  │       Request Data Export          ││
│  └─────────────────────────────────────┘│
│                                         │
│  ┌─────────────────────────────────────┐│
│  │       Delete My Account            ││  ← Destructive
│  └─────────────────────────────────────┘│
│                                         │
└─────────────────────────────────────────┘
```

---

## 4. SwiftUI Pseudocode

### 4.1 Recordings List Screen

```swift
import SwiftUI

// MARK: - Recordings List View

struct RecordingsListView: View {
    @State private var viewModel = RecordingsListViewModel()
    @State private var showingRecordingSheet = false
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            ZStack {
                // Main content
                Group {
                    if viewModel.recordings.isEmpty && !viewModel.isLoading {
                        emptyStateView
                    } else {
                        recordingsList
                    }
                }

                // Floating record button
                VStack {
                    Spacer()
                    recordButton
                        .padding(.bottom, 20)
                }
            }
            .navigationTitle("Recordings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        // Navigate to profile
                    } label: {
                        Image(systemName: "person.circle")
                    }
                }
            }
            .refreshable {
                await viewModel.refresh()
            }
            .fullScreenCover(isPresented: $showingRecordingSheet) {
                RecordingView()
            }
            .task {
                await viewModel.loadRecordings()
            }
        }
    }

    // MARK: - Recordings List

    private var recordingsList: some View {
        List {
            // Search bar (taps to search tab)
            Section {
                NavigationLink {
                    SearchView()
                } label: {
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        Text("Search recordings...")
                            .foregroundStyle(.secondary)
                    }
                }
            }

            // Grouped by date
            ForEach(viewModel.groupedRecordings) { group in
                Section(group.title) {
                    ForEach(group.recordings) { recording in
                        NavigationLink(value: recording) {
                            RecordingRowView(recording: recording)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                viewModel.deleteRecording(recording)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .contextMenu {
                            Button {
                                viewModel.renameRecording(recording)
                            } label: {
                                Label("Rename", systemImage: "pencil")
                            }

                            Button {
                                viewModel.exportRecording(recording)
                            } label: {
                                Label("Export", systemImage: "square.and.arrow.up")
                            }

                            Divider()

                            Button(role: .destructive) {
                                viewModel.deleteRecording(recording)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }

            // Loading indicator for pagination
            if viewModel.hasMorePages {
                Section {
                    HStack {
                        Spacer()
                        ProgressView()
                        Spacer()
                    }
                    .onAppear {
                        Task {
                            await viewModel.loadMoreRecordings()
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationDestination(for: Recording.self) { recording in
            RecordingDetailView(recording: recording)
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        ContentUnavailableView {
            Label("No Recordings", systemImage: "waveform")
        } description: {
            Text("Tap the button below to record your first meeting.")
        }
    }

    // MARK: - Record Button

    private var recordButton: some View {
        Button {
            showingRecordingSheet = true
        } label: {
            HStack(spacing: 8) {
                Circle()
                    .fill(.red)
                    .frame(width: 12, height: 12)
                Text("Record")
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .background(.thinMaterial, in: Capsule())
            .shadow(radius: 4)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Recording Row View

struct RecordingRowView: View {
    let recording: Recording

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                // Status icon
                statusIcon

                // Title
                Text(recording.title)
                    .font(.headline)
                    .lineLimit(1)

                Spacer()

                // Time
                Text(recording.createdAt, format: .dateTime.hour().minute())
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Metadata line
            HStack(spacing: 8) {
                statusLabel

                Text("·")
                    .foregroundStyle(.secondary)

                Text(formatDuration(recording.durationSeconds))
                    .foregroundStyle(.secondary)

                if let speakerCount = recording.speakerCount, speakerCount > 0 {
                    Text("·")
                        .foregroundStyle(.secondary)

                    Text("\(speakerCount) speaker\(speakerCount == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch recording.status {
        case .completed:
            Image(systemName: "doc.text.fill")
                .foregroundStyle(.blue)
        case .transcribing, .summarizing:
            ProgressView()
                .scaleEffect(0.7)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
        default:
            Image(systemName: "waveform")
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var statusLabel: some View {
        switch recording.status {
        case .completed:
            Label("Completed", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .uploading:
            Label("Uploading", systemImage: "arrow.up.circle")
                .foregroundStyle(.orange)
        case .transcribing:
            Label("Transcribing", systemImage: "circle.dotted")
                .foregroundStyle(.blue)
        case .summarizing:
            Label("Summarizing", systemImage: "sparkles")
                .foregroundStyle(.purple)
        case .failed:
            Label("Failed", systemImage: "xmark.circle")
                .foregroundStyle(.red)
        default:
            Label("Processing", systemImage: "circle.dotted")
                .foregroundStyle(.secondary)
        }
    }

    private func formatDuration(_ seconds: Int?) -> String {
        guard let seconds = seconds else { return "--:--" }
        let minutes = seconds / 60
        if minutes < 60 {
            return "\(minutes) min"
        } else {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            return "\(hours)h \(remainingMinutes)m"
        }
    }
}

// MARK: - View Model

@Observable
class RecordingsListViewModel {
    var recordings: [Recording] = []
    var groupedRecordings: [RecordingGroup] = []
    var isLoading = false
    var hasMorePages = true
    var error: Error?

    private let recordingsService: RecordingsService
    private var currentPage = 0

    init(recordingsService: RecordingsService = .shared) {
        self.recordingsService = recordingsService
    }

    func loadRecordings() async {
        isLoading = true
        defer { isLoading = false }

        do {
            recordings = try await recordingsService.fetchRecordings(page: 0)
            groupedRecordings = groupByDate(recordings)
            currentPage = 0
            hasMorePages = recordings.count >= 20 // Page size
        } catch {
            self.error = error
        }
    }

    func loadMoreRecordings() async {
        guard hasMorePages, !isLoading else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            let nextPage = currentPage + 1
            let newRecordings = try await recordingsService.fetchRecordings(page: nextPage)
            recordings.append(contentsOf: newRecordings)
            groupedRecordings = groupByDate(recordings)
            currentPage = nextPage
            hasMorePages = newRecordings.count >= 20
        } catch {
            self.error = error
        }
    }

    func refresh() async {
        await loadRecordings()
    }

    func deleteRecording(_ recording: Recording) {
        Task {
            try? await recordingsService.deleteRecording(id: recording.id)
            await loadRecordings()
        }
    }

    func renameRecording(_ recording: Recording) {
        // Show rename alert
    }

    func exportRecording(_ recording: Recording) {
        // Show export sheet
    }

    private func groupByDate(_ recordings: [Recording]) -> [RecordingGroup] {
        let calendar = Calendar.current
        let grouped = Dictionary(grouping: recordings) { recording in
            calendar.startOfDay(for: recording.createdAt)
        }

        return grouped.map { date, recordings in
            RecordingGroup(
                date: date,
                title: formatGroupTitle(date),
                recordings: recordings.sorted { $0.createdAt > $1.createdAt }
            )
        }
        .sorted { $0.date > $1.date }
    }

    private func formatGroupTitle(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "Today"
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            return date.formatted(.dateTime.month().day().year())
        }
    }
}

// MARK: - Models

struct Recording: Identifiable, Hashable {
    let id: UUID
    var title: String
    var durationSeconds: Int?
    var status: RecordingStatus
    var speakerCount: Int?
    var createdAt: Date
}

enum RecordingStatus: String {
    case uploading
    case uploaded
    case transcribing
    case transcribed
    case summarizing
    case completed
    case failed
}

struct RecordingGroup: Identifiable {
    let id = UUID()
    let date: Date
    let title: String
    let recordings: [Recording]
}
```

### 4.2 Recording Detail Screen

```swift
import SwiftUI

// MARK: - Recording Detail View

struct RecordingDetailView: View {
    let recording: Recording
    @State private var viewModel: RecordingDetailViewModel
    @State private var selectedTab: DetailTab = .summary
    @State private var showingExportSheet = false
    @State private var showingMoreOptions = false

    init(recording: Recording) {
        self.recording = recording
        self._viewModel = State(initialValue: RecordingDetailViewModel(recordingId: recording.id))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Metadata header
            metadataHeader

            // Audio player
            AudioPlayerView(viewModel: viewModel.audioPlayer)
                .padding()
                .background(Color(.systemGray6))

            // Tab picker
            Picker("View", selection: $selectedTab) {
                ForEach(DetailTab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding()

            // Tab content
            TabView(selection: $selectedTab) {
                SummaryTabView(summary: viewModel.summary)
                    .tag(DetailTab.summary)

                TranscriptTabView(
                    transcript: viewModel.transcript,
                    audioPlayer: viewModel.audioPlayer
                )
                .tag(DetailTab.transcript)

                KeyPointsTabView(summary: viewModel.summary)
                    .tag(DetailTab.keyPoints)

                QATabView(viewModel: viewModel.qaViewModel)
                    .tag(DetailTab.qa)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .navigationTitle(recording.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button {
                        // Rename action
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }

                    Button {
                        // Reprocess action
                    } label: {
                        Label("Reprocess", systemImage: "arrow.clockwise")
                    }

                    Divider()

                    Button(role: .destructive) {
                        // Delete action
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }

            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingExportSheet = true
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
        .sheet(isPresented: $showingExportSheet) {
            ExportSheet(recording: recording)
        }
        .task {
            await viewModel.loadDetails()
        }
    }

    private var metadataHeader: some View {
        HStack {
            Text(recording.createdAt, format: .dateTime.month().day().year())
            Text("·")
            Text(formatDuration(recording.durationSeconds))
            if let speakers = viewModel.transcript?.speakerCount, speakers > 0 {
                Text("·")
                Text("\(speakers) speakers")
            }
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private func formatDuration(_ seconds: Int?) -> String {
        guard let seconds = seconds else { return "--:--" }
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        return String(format: "%d:%02d", minutes, remainingSeconds)
    }
}

// MARK: - Detail Tabs

enum DetailTab: String, CaseIterable, Identifiable {
    case summary
    case transcript
    case keyPoints
    case qa

    var id: String { rawValue }

    var title: String {
        switch self {
        case .summary: return "Summary"
        case .transcript: return "Transcript"
        case .keyPoints: return "Key Points"
        case .qa: return "Q&A"
        }
    }
}

// MARK: - Audio Player View

struct AudioPlayerView: View {
    @Bindable var viewModel: AudioPlayerViewModel

    var body: some View {
        VStack(spacing: 12) {
            // Progress slider
            Slider(
                value: $viewModel.currentTime,
                in: 0...max(viewModel.duration, 1),
                onEditingChanged: viewModel.seek
            )

            // Time labels
            HStack {
                Text(formatTime(viewModel.currentTime))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()

                Spacer()

                Text(formatTime(viewModel.duration))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            // Controls
            HStack(spacing: 32) {
                // Skip back 15s
                Button {
                    viewModel.skipBackward()
                } label: {
                    Image(systemName: "gobackward.15")
                        .font(.title2)
                }

                // Play/Pause
                Button {
                    viewModel.togglePlayPause()
                } label: {
                    Image(systemName: viewModel.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 50))
                }

                // Skip forward 15s
                Button {
                    viewModel.skipForward()
                } label: {
                    Image(systemName: "goforward.15")
                        .font(.title2)
                }
            }

            // Playback speed
            Menu {
                ForEach([0.5, 0.75, 1.0, 1.25, 1.5, 2.0], id: \.self) { speed in
                    Button {
                        viewModel.setPlaybackSpeed(speed)
                    } label: {
                        HStack {
                            Text("\(speed, specifier: "%.2g")x")
                            if viewModel.playbackSpeed == speed {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                Text("\(viewModel.playbackSpeed, specifier: "%.2g")x")
                    .font(.subheadline)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(.systemGray5), in: Capsule())
            }
        }
    }

    private func formatTime(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - Summary Tab

struct SummaryTabView: View {
    let summary: Summary?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let summary = summary {
                    // Summary text
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Summary")
                            .font(.headline)
                        Text(summary.text)
                            .font(.body)
                    }

                    // Topics
                    if !summary.topics.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Topics Discussed")
                                .font(.headline)

                            FlowLayout(spacing: 8) {
                                ForEach(summary.topics, id: \.self) { topic in
                                    Text(topic)
                                        .font(.subheadline)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(Color.blue.opacity(0.1), in: Capsule())
                                }
                            }
                        }
                    }
                } else {
                    // Loading or unavailable
                    ContentUnavailableView {
                        Label("Summary Unavailable", systemImage: "doc.text")
                    } description: {
                        Text("The summary is still being generated or is unavailable.")
                    }
                }
            }
            .padding()
        }
    }
}

// MARK: - Transcript Tab

struct TranscriptTabView: View {
    let transcript: Transcript?
    @Bindable var audioPlayer: AudioPlayerViewModel
    @State private var searchText = ""

    var body: some View {
        VStack(spacing: 0) {
            // Search bar
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search in transcript...", text: $searchText)
            }
            .padding(10)
            .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 10))
            .padding()

            // Transcript segments
            if let transcript = transcript {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 16) {
                            ForEach(filteredSegments) { segment in
                                TranscriptSegmentView(
                                    segment: segment,
                                    isActive: isSegmentActive(segment),
                                    searchQuery: searchText,
                                    onTimestampTap: {
                                        audioPlayer.seek(to: segment.startTime)
                                    }
                                )
                                .id(segment.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: audioPlayer.currentTime) { _, newTime in
                        // Auto-scroll to current segment
                        if let activeSegment = transcript.segments.first(where: { isSegmentActive($0) }) {
                            withAnimation {
                                proxy.scrollTo(activeSegment.id, anchor: .center)
                            }
                        }
                    }
                }
            } else {
                ContentUnavailableView {
                    Label("Transcript Unavailable", systemImage: "text.alignleft")
                } description: {
                    Text("The transcript is still being generated or is unavailable.")
                }
            }
        }
    }

    private var filteredSegments: [TranscriptSegment] {
        guard let segments = transcript?.segments else { return [] }
        guard !searchText.isEmpty else { return segments }
        return segments.filter { $0.text.localizedCaseInsensitiveContains(searchText) }
    }

    private func isSegmentActive(_ segment: TranscriptSegment) -> Bool {
        audioPlayer.currentTime >= segment.startTime &&
        audioPlayer.currentTime < segment.endTime
    }
}

struct TranscriptSegmentView: View {
    let segment: TranscriptSegment
    let isActive: Bool
    let searchQuery: String
    let onTimestampTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                // Speaker label
                Text(segment.speaker)
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.blue)

                Spacer()

                // Timestamp button
                Button {
                    onTimestampTap()
                } label: {
                    Text(formatTimestamp(segment.startTime))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            // Text with highlighting
            Text(highlightedText)
                .font(.body)
        }
        .padding()
        .background(isActive ? Color.blue.opacity(0.1) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isActive ? Color.blue.opacity(0.3) : Color.clear, lineWidth: 1)
        )
    }

    private var highlightedText: AttributedString {
        var attributedString = AttributedString(segment.text)

        guard !searchQuery.isEmpty else { return attributedString }

        // Highlight search matches
        var searchRange = attributedString.startIndex..<attributedString.endIndex
        while let range = attributedString[searchRange].range(of: searchQuery, options: .caseInsensitive) {
            attributedString[range].backgroundColor = .yellow
            searchRange = range.upperBound..<attributedString.endIndex
        }

        return attributedString
    }

    private func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}

// MARK: - Key Points Tab

struct KeyPointsTabView: View {
    let summary: Summary?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let summary = summary {
                    // Key Points
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Key Points")
                            .font(.headline)

                        ForEach(summary.keyPoints, id: \.self) { point in
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: "circle.fill")
                                    .font(.system(size: 6))
                                    .padding(.top, 6)
                                Text(point)
                            }
                        }
                    }

                    // Action Items
                    if !summary.actionItems.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Action Items")
                                .font(.headline)

                            ForEach(summary.actionItems, id: \.self) { item in
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: "square")
                                        .foregroundStyle(.secondary)
                                    Text(item)
                                }
                            }
                        }
                    }
                } else {
                    ContentUnavailableView {
                        Label("Key Points Unavailable", systemImage: "list.bullet")
                    }
                }
            }
            .padding()
        }
    }
}

// MARK: - Q&A Tab

struct QATabView: View {
    @Bindable var viewModel: QAViewModel
    @FocusState private var isInputFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Chat history
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(viewModel.messages) { message in
                            QAMessageView(message: message, onCitationTap: viewModel.seekToCitation)
                                .id(message.id)
                        }

                        if viewModel.isLoading {
                            HStack {
                                ProgressView()
                                    .padding(.horizontal)
                                Text("Thinking...")
                                    .foregroundStyle(.secondary)
                                Spacer()
                            }
                            .padding()
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) {
                    // Scroll to latest message
                    if let lastMessage = viewModel.messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            Divider()

            // Input area
            HStack(spacing: 12) {
                TextField("Ask a question...", text: $viewModel.inputText, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...4)
                    .focused($isInputFocused)

                Button {
                    Task {
                        await viewModel.askQuestion()
                    }
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .disabled(viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || viewModel.isLoading)
            }
            .padding()
            .background(Color(.systemBackground))
        }
    }
}

struct QAMessageView: View {
    let message: QAMessage
    let onCitationTap: (Double) -> Void

    var body: some View {
        VStack(alignment: message.isUser ? .trailing : .leading, spacing: 8) {
            Text(message.text)
                .padding(12)
                .background(message.isUser ? Color.blue : Color(.systemGray5), in: RoundedRectangle(cornerRadius: 16))
                .foregroundStyle(message.isUser ? .white : .primary)

            // Citations (for AI responses)
            if !message.isUser, !message.citations.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "quote.opening")
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    ForEach(message.citations, id: \.timestamp) { citation in
                        Button {
                            onCitationTap(citation.timestamp)
                        } label: {
                            Text(formatTimestamp(citation.timestamp))
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.blue.opacity(0.1), in: Capsule())
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: message.isUser ? .trailing : .leading)
    }

    private func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}

// MARK: - View Models

@Observable
class RecordingDetailViewModel {
    let recordingId: UUID
    var transcript: Transcript?
    var summary: Summary?
    var isLoading = false
    var error: Error?

    let audioPlayer: AudioPlayerViewModel
    let qaViewModel: QAViewModel

    private let recordingsService: RecordingsService

    init(recordingId: UUID, recordingsService: RecordingsService = .shared) {
        self.recordingId = recordingId
        self.recordingsService = recordingsService
        self.audioPlayer = AudioPlayerViewModel()
        self.qaViewModel = QAViewModel(recordingId: recordingId)
    }

    func loadDetails() async {
        isLoading = true
        defer { isLoading = false }

        do {
            async let transcriptTask = recordingsService.fetchTranscript(recordingId: recordingId)
            async let summaryTask = recordingsService.fetchSummary(recordingId: recordingId)

            let (transcriptResult, summaryResult) = try await (transcriptTask, summaryTask)

            self.transcript = transcriptResult
            self.summary = summaryResult

            // Initialize audio player with recording URL
            if let audioURL = try? await recordingsService.getAudioURL(recordingId: recordingId) {
                await audioPlayer.load(url: audioURL)
            }
        } catch {
            self.error = error
        }
    }
}

@Observable
class AudioPlayerViewModel {
    var isPlaying = false
    var currentTime: Double = 0
    var duration: Double = 0
    var playbackSpeed: Double = 1.0

    func load(url: URL) async {
        // Load audio file and set duration
    }

    func togglePlayPause() {
        isPlaying.toggle()
    }

    func skipForward() {
        currentTime = min(currentTime + 15, duration)
    }

    func skipBackward() {
        currentTime = max(currentTime - 15, 0)
    }

    func seek(editing: Bool) {
        // Handle seek from slider
    }

    func seek(to time: Double) {
        currentTime = time
    }

    func setPlaybackSpeed(_ speed: Double) {
        playbackSpeed = speed
    }
}

@Observable
class QAViewModel {
    let recordingId: UUID
    var messages: [QAMessage] = []
    var inputText = ""
    var isLoading = false

    private let qaService: QAService

    init(recordingId: UUID, qaService: QAService = .shared) {
        self.recordingId = recordingId
        self.qaService = qaService
    }

    func askQuestion() async {
        let question = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !question.isEmpty else { return }

        // Add user message
        let userMessage = QAMessage(id: UUID(), text: question, isUser: true, citations: [])
        messages.append(userMessage)
        inputText = ""

        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await qaService.askQuestion(recordingId: recordingId, question: question)
            let aiMessage = QAMessage(
                id: UUID(),
                text: response.answer,
                isUser: false,
                citations: response.citations
            )
            messages.append(aiMessage)
        } catch {
            let errorMessage = QAMessage(
                id: UUID(),
                text: "Sorry, I couldn't process your question. Please try again.",
                isUser: false,
                citations: []
            )
            messages.append(errorMessage)
        }
    }

    func seekToCitation(_ timestamp: Double) {
        // Notify audio player to seek
    }
}

// MARK: - Models

struct Transcript {
    let segments: [TranscriptSegment]
    let speakerCount: Int
}

struct TranscriptSegment: Identifiable {
    let id: UUID
    let speaker: String
    let text: String
    let startTime: Double
    let endTime: Double
}

struct Summary {
    let text: String
    let keyPoints: [String]
    let actionItems: [String]
    let topics: [String]
}

struct QAMessage: Identifiable {
    let id: UUID
    let text: String
    let isUser: Bool
    let citations: [Citation]
}

struct Citation {
    let timestamp: Double
    let text: String
}

// MARK: - Placeholder Services

class RecordingsService {
    static let shared = RecordingsService()

    func fetchRecordings(page: Int) async throws -> [Recording] { [] }
    func deleteRecording(id: UUID) async throws {}
    func fetchTranscript(recordingId: UUID) async throws -> Transcript? { nil }
    func fetchSummary(recordingId: UUID) async throws -> Summary? { nil }
    func getAudioURL(recordingId: UUID) async throws -> URL? { nil }
}

class QAService {
    static let shared = QAService()

    struct QAResponse {
        let answer: String
        let citations: [Citation]
    }

    func askQuestion(recordingId: UUID, question: String) async throws -> QAResponse {
        QAResponse(answer: "", citations: [])
    }
}

// MARK: - Helper Views

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        // Calculate flow layout size
        let width = proposal.width ?? .infinity
        var height: CGFloat = 0
        var x: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width {
                x = 0
                height += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        height += rowHeight

        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
```

---

## 5. Screen Flow Summary

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           APP LAUNCH                                         │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    Has Valid Session?     │
                    └─────────────┬─────────────┘
                          │               │
                         Yes              No
                          │               │
                          ▼               ▼
              ┌───────────────┐   ┌───────────────┐
              │ Recordings    │   │   Welcome     │
              │    List       │   │   Screen      │
              └───────┬───────┘   └───────┬───────┘
                      │                   │
                      │                   ▼
                      │           ┌───────────────┐
                      │           │  Auth Choice  │
                      │           └───────┬───────┘
                      │                   │
                      │           ┌───────┴───────┐
                      │           ▼               ▼
                      │   ┌─────────────┐ ┌─────────────┐
                      │   │ Magic Link  │ │   Login /   │
                      │   │    Entry    │ │  Register   │
                      │   └──────┬──────┘ └──────┬──────┘
                      │          │               │
                      │          └───────┬───────┘
                      │                  │
                      ◄──────────────────┘
                      │
        ┌─────────────┴─────────────────────────────────┐
        │                                               │
        │              MAIN TAB VIEW                    │
        │  ┌─────────┐  ┌─────────┐  ┌─────────────┐   │
        │  │Recordings│  │ Search  │  │  Settings   │   │
        │  │   Tab   │  │   Tab   │  │    Tab      │   │
        │  └────┬────┘  └────┬────┘  └──────┬──────┘   │
        │       │            │              │          │
        │       ▼            │              ▼          │
        │  ┌─────────┐       │         ┌─────────┐    │
        │  │Recording│       │         │ Profile │    │
        │  │ Detail  │◄──────┘         │ Privacy │    │
        │  └─────────┘                 ��  Help   │    │
        │                              └─────────┘    │
        │                                              │
        │  ┌────────────────────────────────────────┐  │
        │  │     FLOATING RECORD BUTTON             │  │
        │  │           (always visible)              │  │
        │  └────────────────┬───────────────────────┘  │
        │                   │                          │
        └───────────────────┼──────────────────────────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │  Recording Modal  │ (Full screen)
                  │  ┌─────────────┐  │
                  │  │   Timer     │  │
                  │  │   Levels    │  │
                  │  │   Stop Btn  │  │
                  │  └─────────────┘  │
                  └─────────┬─────────┘
                            │
                            ▼
                  ┌───────────────────┐
                  │   Save Sheet      │
                  │  (Enter title)    │
                  └─────────┬─────────┘
                            │
                            ▼
                  Back to Recordings List
                  (with new recording showing)
```

---

*Document version: 1.0*
*Last updated: January 2026*
