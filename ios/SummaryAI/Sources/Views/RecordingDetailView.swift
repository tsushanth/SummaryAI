import SwiftUI
import AVFoundation
import PaywallKit

// MARK: - Recording Detail View Wrapper

/// Wrapper to inject the API client from environment into the view model
struct RecordingDetailView: View {
    @EnvironmentObject var apiClient: SummaryAIAPIClient
    let recordingId: String

    var body: some View {
        RecordingDetailContentView(recordingId: recordingId, apiClient: apiClient)
    }
}

// MARK: - Recording Detail Content View

/// Detail view for a single recording showing summary, transcript, and Q&A
struct RecordingDetailContentView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: RecordingDetailViewModel
    @StateObject private var liveTranscriptViewModel: LiveTranscriptViewModel
    @State private var selectedTab: DetailTab = .summary
    @State private var showShareSheet = false
    @State private var showDeleteConfirmation = false
    @State private var showLiveTranscript = false
    @State private var showSpeakerEditor = false
    @State private var showAIPaywall = false

    private let apiClient: SummaryAIAPIClient

    init(recordingId: String, apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: RecordingDetailViewModel(recordingId: recordingId, apiClient: apiClient))
        // Initialize with empty meeting ID - will be updated when recording loads
        _liveTranscriptViewModel = StateObject(wrappedValue: LiveTranscriptViewModel(meetingId: "", apiClient: apiClient))
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                loadingView

            case .loaded:
                loadedContentView

            case .error(let message):
                errorView(message: message)
            }
        }
        .navigationTitle(viewModel.recording?.title ?? "Recording")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 16) {
                    // Favorite button
                    Button {
                        // Toggle favorite
                    } label: {
                        Image(systemName: viewModel.recording?.isFavorite == true ? "heart.fill" : "heart")
                            .foregroundColor(viewModel.recording?.isFavorite == true ? .red : .primary)
                    }

                    // Share button
                    Button {
                        showShareSheet = true
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                    }

                    // More options
                    Menu {
                        Button {
                            // Rename
                        } label: {
                            Label("Rename", systemImage: "pencil")
                        }

                        Button {
                            showSpeakerEditor = true
                        } label: {
                            Label("Rename Speakers", systemImage: "person.text.rectangle")
                        }
                        .disabled(viewModel.transcript == nil)

                        Button {
                            // Move to folder
                        } label: {
                            Label("Move to Folder", systemImage: "folder")
                        }

                        Divider()

                        Button(role: .destructive) {
                            showDeleteConfirmation = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .task {
            await viewModel.loadRecording()
            // Auto-select transcript tab with live mode if this is a live meeting
            if let recording = viewModel.recording, recording.isLiveMeeting {
                selectedTab = .transcript
                showLiveTranscript = true
                if let meetingId = recording.meetingId {
                    liveTranscriptViewModel.updateMeetingId(meetingId)
                    liveTranscriptViewModel.startPolling()
                }
            }
        }
        .onDisappear {
            viewModel.stopStatusPolling()
            liveTranscriptViewModel.stopPolling()
        }
        .refreshable {
            await viewModel.refreshRecording()
        }
        .alert("Error", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) {
                viewModel.clearError()
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
        .sheet(isPresented: $showShareSheet) {
            if let recording = viewModel.recording {
                ShareExportView(
                    recording: recording,
                    summary: viewModel.summary,
                    transcript: viewModel.transcript,
                    audioURL: viewModel.audioURL
                ) {
                    showShareSheet = false
                }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .sheet(isPresented: $showSpeakerEditor) {
            if let transcript = viewModel.transcript {
                EditSpeakerNamesView(
                    transcript: transcript,
                    onSave: { names in
                        await viewModel.updateSpeakerNames(names)
                    },
                    onDismiss: { showSpeakerEditor = false }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
            }
        }
        .confirmationDialog(
            "Delete Recording?",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task {
                    let success = await viewModel.deleteRecording()
                    if success {
                        dismiss()
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete this recording and all associated data. This action cannot be undone.")
        }
        .sheet(isPresented: $showAIPaywall) {
            RemotePaywallView(triggerSource: "ai_feature_gate")
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
            Text("Loading recording...")
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Loaded Content

    private var loadedContentView: some View {
        VStack(spacing: 0) {
            // Processing banner if still processing
            if viewModel.isProcessing {
                processingBanner
            }

            // Styled tab picker with icons
            styledTabPicker

            // Tab content
            TabView(selection: $selectedTab) {
                summaryTabView
                    .tag(DetailTab.summary)

                transcriptTabView
                    .tag(DetailTab.transcript)

                chatTabView
                    .tag(DetailTab.chat)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            // Audio player at bottom (hide for PDFs/imported documents without audio)
            if let recording = viewModel.recording,
               let duration = recording.durationSeconds,
               duration > 0,
               recording.recordingType != .imported,
               !viewModel.isProcessing {
                AudioPlayerView(
                    audioURL: viewModel.audioURL,
                    duration: TimeInterval(duration)
                ) { timestamp in
                    // Seek to timestamp in transcript
                    if let transcript = viewModel.transcript {
                        if let segment = transcript.segments.first(where: { $0.contains(time: timestamp) }) {
                            viewModel.selectSegment(segment)
                            selectedTab = .transcript
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        }
    }

    // MARK: - Processing Banner

    private var processingBanner: some View {
        HStack(spacing: 12) {
            if viewModel.recording?.isLiveMeeting == true {
                // Live meeting indicator
                Circle()
                    .fill(Color.red)
                    .frame(width: 10, height: 10)

                Text("Live Recording in Progress")
                    .font(.subheadline)
                    .fontWeight(.medium)
            } else {
                ProgressView()
                    .scaleEffect(0.8)

                Text(viewModel.recording?.status.displayText ?? "Processing...")
                    .font(.subheadline)
            }

            Spacer()
        }
        .padding()
        .background(viewModel.recording?.isLiveMeeting == true ? Color.red.opacity(0.15) : Color.orange.opacity(0.15))
        .foregroundColor(viewModel.recording?.isLiveMeeting == true ? .red : .orange)
    }

    // MARK: - Styled Tab Picker

    private var styledTabPicker: some View {
        HStack(spacing: 0) {
            ForEach(DetailTab.allCases) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        selectedTab = tab
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.icon)
                            .font(.system(size: 14))
                        Text(tab.title)
                            .font(.subheadline)
                            .fontWeight(.medium)
                    }
                    .foregroundColor(selectedTab == tab ? .blue : .secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(selectedTab == tab ? Color.blue.opacity(0.1) : Color.clear)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    // MARK: - Summary Tab

    private var summaryTabView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let summary = viewModel.summary {
                    if PremiumManager.shared.isPremium {
                        // Premium users see full content
                        // Action items section (with blue checkmarks)
                        if let actionItems = summary.actionItems, !actionItems.isEmpty {
                            actionItemsSection(actionItems)
                        }

                        // Overview section (key points as bullet list)
                        if !summary.keyPoints.isEmpty {
                            overviewSection(summary.keyPoints)
                        }

                        // Main summary section
                        summarySection(summary)

                        // Topics
                        if let topics = summary.topics, !topics.isEmpty {
                            topicsSection(topics)
                        }
                    } else {
                        // Free users see blurred preview with upgrade prompt
                        VStack(spacing: 0) {
                            // Show first key point as teaser (if available)
                            if let firstPoint = summary.keyPoints.first {
                                HStack(alignment: .top, spacing: 8) {
                                    Text("\u{2022}")
                                        .font(.body)
                                        .foregroundColor(.secondary)
                                    Text(firstPoint)
                                        .font(.body)
                                }
                                .padding(.bottom, 12)
                            }

                            // Blurred placeholder for rest of content
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(0..<4, id: \.self) { _ in
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Color.gray.opacity(0.15))
                                        .frame(height: 14)
                                        .frame(maxWidth: .infinity)
                                }
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.gray.opacity(0.15))
                                    .frame(height: 14)
                                    .frame(width: 200)
                            }
                            .padding(.bottom, 24)

                            // Upgrade prompt
                            VStack(spacing: 12) {
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 32))
                                    .foregroundColor(.blue)

                                Text("Unlock AI Summaries")
                                    .font(.headline)

                                Text("Upgrade to Pro to view full AI-generated summaries, action items, and key points.")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                    .multilineTextAlignment(.center)

                                Button {
                                    showAIPaywall = true
                                } label: {
                                    Text("Upgrade to Pro")
                                        .font(.headline)
                                        .frame(maxWidth: .infinity)
                                        .frame(height: 50)
                                        .background(Color.blue)
                                        .foregroundColor(.white)
                                        .cornerRadius(12)
                                }
                                .padding(.top, 4)
                            }
                            .padding()
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(16)
                        }
                    }
                } else if viewModel.isProcessing {
                    processingPlaceholder(message: "Summary will appear here once processing is complete.")
                } else {
                    emptyPlaceholder(message: "No summary available.")
                }
            }
            .padding()
        }
    }

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let recording = viewModel.recording {
                HStack(spacing: 16) {
                    // Show document icon for PDFs, duration for audio
                    if recording.recordingType == .imported {
                        Label("Document", systemImage: "doc.fill")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    } else if let duration = viewModel.formattedDuration {
                        Label(duration, systemImage: "clock")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }

                    // Word count if available
                    if let wordCount = recording.wordCount, wordCount > 0 {
                        Label("\(wordCount) words", systemImage: "text.word.spacing")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }

                    // Date
                    Label(recording.createdAt.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }

                // Status badge
                StatusBadge(status: recording.status)
            }
        }
    }

    private func summarySection(_ summary: RecordingSummary) -> some View {
        let names = viewModel.transcript?.speakerNames
        return VStack(alignment: .leading, spacing: 8) {
            Text("Summary")
                .font(.headline)

            Text(summary.summary.applyingSpeakerNames(names))
                .font(.body)
                .foregroundColor(.primary)
        }
    }

    private func keyPointsSection(_ keyPoints: [String]) -> some View {
        let names = viewModel.transcript?.speakerNames
        return VStack(alignment: .leading, spacing: 12) {
            Text("Key Points")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(keyPoints, id: \.self) { point in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.subheadline)

                        Text(point.applyingSpeakerNames(names))
                            .font(.body)
                    }
                }
            }
        }
    }

    private func overviewSection(_ keyPoints: [String]) -> some View {
        let names = viewModel.transcript?.speakerNames
        return VStack(alignment: .leading, spacing: 12) {
            // Header with sparkle icon
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .foregroundColor(.orange)
                Text("Overview")
                    .font(.headline)
            }

            VStack(alignment: .leading, spacing: 8) {
                ForEach(keyPoints, id: \.self) { point in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•")
                            .font(.body)
                            .foregroundColor(.secondary)

                        Text(point.applyingSpeakerNames(names))
                            .font(.body)
                    }
                }
            }
        }
    }

    private func actionItemsSection(_ actionItems: [ActionItem]) -> some View {
        let names = viewModel.transcript?.speakerNames
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(actionItems) { item in
                    HStack(alignment: .top, spacing: 12) {
                        // Blue checkmark circle
                        ZStack {
                            Circle()
                                .fill(Color.blue)
                                .frame(width: 22, height: 22)

                            Image(systemName: "checkmark")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(.white)
                        }

                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.task.applyingSpeakerNames(names))
                                .font(.body)

                            if let assignee = item.assignee {
                                HStack(spacing: 4) {
                                    Image(systemName: "person.fill")
                                        .font(.caption2)
                                    Text(assignee.applyingSpeakerNames(names))
                                }
                                .font(.caption)
                                .foregroundColor(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func topicsSection(_ topics: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Topics")
                .font(.headline)

            FlowLayout(spacing: 8) {
                ForEach(topics, id: \.self) { topic in
                    Text(topic)
                        .font(.caption)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.blue.opacity(0.1))
                        .foregroundColor(.blue)
                        .cornerRadius(16)
                }
            }
        }
    }

    // MARK: - Transcript Tab

    private var transcriptTabView: some View {
        VStack(spacing: 0) {
            // Live/Full toggle for live meetings
            if viewModel.recording?.isLiveMeeting == true {
                transcriptModeToggle
            }

            // Content based on mode
            if showLiveTranscript && viewModel.recording?.isLiveMeeting == true {
                liveTranscriptContent
            } else {
                fullTranscriptContent
            }
        }
    }

    private var transcriptModeToggle: some View {
        HStack(spacing: 0) {
            // Live button
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showLiveTranscript = true
                    if let meetingId = viewModel.recording?.meetingId {
                        liveTranscriptViewModel.updateMeetingId(meetingId)
                        liveTranscriptViewModel.startPolling()
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 8, height: 8)
                    Text("Live")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                .foregroundColor(showLiveTranscript ? .red : .secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(showLiveTranscript ? Color.red.opacity(0.1) : Color.clear)
                )
            }
            .buttonStyle(.plain)

            // Full button
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showLiveTranscript = false
                    liveTranscriptViewModel.stopPolling()
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 12))
                    Text("Full")
                        .font(.subheadline)
                        .fontWeight(.medium)
                }
                .foregroundColor(!showLiveTranscript ? .blue : .secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(!showLiveTranscript ? Color.blue.opacity(0.1) : Color.clear)
                )
            }
            .buttonStyle(.plain)
        }
        .padding(4)
        .background(Color(.tertiarySystemBackground))
        .cornerRadius(10)
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private var liveTranscriptContent: some View {
        VStack(spacing: 0) {
            // Live indicator banner
            HStack(spacing: 8) {
                Circle()
                    .fill(Color.red)
                    .frame(width: 10, height: 10)
                    .overlay(
                        Circle()
                            .stroke(Color.red.opacity(0.3), lineWidth: 3)
                            .scaleEffect(1.4)
                    )

                Text("Live")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.red)

                Spacer()

                Text("\(liveTranscriptViewModel.segments.count) segments")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color.red.opacity(0.05))

            // Live transcript content
            if liveTranscriptViewModel.segments.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "waveform")
                        .font(.system(size: 48))
                        .foregroundColor(.gray.opacity(0.5))

                    Text("Waiting for transcript...")
                        .font(.headline)
                        .foregroundColor(.secondary)

                    Text("Transcript will appear here as the meeting progresses")
                        .font(.subheadline)
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)

                    if liveTranscriptViewModel.isLoading {
                        ProgressView()
                            .padding(.top, 8)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(liveTranscriptViewModel.segments) { segment in
                                LiveSegmentRow(
                                    segment: segment,
                                    timestamp: liveTranscriptViewModel.formatTimestamp(segment.startTimestamp),
                                    colorIndex: liveTranscriptViewModel.colorIndex(for: segment.speakerId)
                                )
                                .id(segment.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: liveTranscriptViewModel.segments.count) { _, _ in
                        if let lastId = liveTranscriptViewModel.segments.last?.id {
                            withAnimation(.easeOut(duration: 0.2)) {
                                proxy.scrollTo(lastId, anchor: .bottom)
                            }
                        }
                    }
                }
            }
        }
        .onAppear {
            if let meetingId = viewModel.recording?.meetingId {
                liveTranscriptViewModel.updateMeetingId(meetingId)
                liveTranscriptViewModel.startPolling()
            }
        }
        .onDisappear {
            liveTranscriptViewModel.stopPolling()
        }
    }

    private var fullTranscriptContent: some View {
        Group {
            if let transcript = viewModel.transcript, !transcript.segments.isEmpty {
                ScrollViewReader { proxy in
                    List {
                        ForEach(Array(transcript.segments.enumerated()), id: \.element.id) { index, segment in
                            TranscriptSegmentRow(
                                segment: segment,
                                isSelected: viewModel.selectedSegment?.id == segment.id,
                                formatTimestamp: viewModel.formatTimestamp,
                                speakerNames: transcript.speakerNames
                            )
                            .id(segment.id)
                            .onTapGesture {
                                viewModel.selectSegment(segment)
                            }
                        }
                    }
                    .listStyle(.plain)
                    .onChange(of: viewModel.selectedSegment) { _, newSegment in
                        if let segment = newSegment {
                            withAnimation {
                                proxy.scrollTo(segment.id, anchor: .center)
                            }
                        }
                    }
                }
            } else if viewModel.isProcessing {
                processingPlaceholder(message: "Transcript will appear here once transcription is complete.")
            } else {
                emptyPlaceholder(message: "No transcript available.")
            }
        }
    }

    // MARK: - Chat Tab

    private var chatTabView: some View {
        VStack(spacing: 0) {
            if PremiumManager.shared.isPremium {
                // Premium users get full chat access
                if viewModel.qaHistory.isEmpty && viewModel.currentAnswer == nil {
                    chatWelcomeView
                } else {
                    chatHistoryList
                }

                // Chat input bar at bottom
                chatInputBar
            } else {
                // Free users see locked chat
                VStack(spacing: 24) {
                    Spacer()

                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .font(.system(size: 56))
                        .foregroundColor(.blue.opacity(0.5))

                    VStack(spacing: 8) {
                        Text("AI Chat is a Pro Feature")
                            .font(.title3)
                            .fontWeight(.semibold)

                        Text("Ask questions about your recordings, get action items, draft follow-up emails, and more.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }

                    Button {
                        showAIPaywall = true
                    } label: {
                        Text("Upgrade to Pro")
                            .font(.headline)
                            .frame(width: 220, height: 50)
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                    }

                    Spacer()
                }
            }
        }
    }

    private var chatWelcomeView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // AI Assistant header with icon
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.blue.opacity(0.1))
                            .frame(width: 44, height: 44)

                        Image(systemName: "waveform.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(.blue)
                    }

                    Text("Meeting Mind")
                        .font(.headline)
                }
                .padding(.top, 8)

                // Welcome message
                VStack(alignment: .leading, spacing: 16) {
                    Text("Hello there! What can I answer about your recording?")
                        .font(.body)
                        .foregroundColor(.primary)
                        .padding()
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(12)

                    // Suggested questions
                    VStack(spacing: 12) {
                        SuggestedQuestionRow(
                            text: "Key points in the meeting",
                            onTap: {
                                viewModel.questionText = "What are the key points discussed in this meeting?"
                                Task { await viewModel.askQuestion() }
                            }
                        )

                        SuggestedQuestionRow(
                            text: "Main action items",
                            onTap: {
                                viewModel.questionText = "What are the main action items from this recording?"
                                Task { await viewModel.askQuestion() }
                            }
                        )

                        SuggestedQuestionRow(
                            text: "Draft a follow-up email",
                            onTap: {
                                viewModel.questionText = "Draft a follow-up email based on this meeting"
                                Task { await viewModel.askQuestion() }
                            }
                        )
                    }
                }
            }
            .padding()
        }
    }

    private var chatHistoryList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    // Current answer (if any)
                    if let currentAnswer = viewModel.currentAnswer {
                        ChatMessageView(
                            item: currentAnswer,
                            isLatest: true,
                            onCitationTap: { citation in
                                jumpToTranscriptSegment(at: citation.timestamp)
                            }
                        )
                        .id("current")
                    }

                    // History
                    ForEach(viewModel.qaHistory.filter { $0.id != viewModel.currentAnswer?.id }) { item in
                        ChatMessageView(
                            item: item,
                            isLatest: false,
                            onCitationTap: { citation in
                                jumpToTranscriptSegment(at: citation.timestamp)
                            }
                        )
                        .id(item.id)
                    }
                }
                .padding()
            }
            .onChange(of: viewModel.currentAnswer) { _, newAnswer in
                if newAnswer != nil {
                    withAnimation {
                        proxy.scrollTo("current", anchor: .top)
                    }
                }
            }
        }
    }

    private var chatInputBar: some View {
        VStack(spacing: 0) {
            Divider()

            HStack(spacing: 12) {
                // Text input field
                HStack {
                    TextField("Ask anything about this note", text: $viewModel.questionText, axis: .vertical)
                        .lineLimit(1...3)
                        .disabled(!viewModel.canAskQuestions || viewModel.qaState == .asking)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(24)

                // Mic button
                Button {
                    // Voice input (placeholder)
                    Task { await viewModel.askQuestion() }
                } label: {
                    ZStack {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 48, height: 48)

                        if viewModel.qaState == .asking {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else if viewModel.questionText.isEmpty {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.white)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundColor(.white)
                        }
                    }
                }
                .disabled(!viewModel.canAskQuestions || (viewModel.questionText.isEmpty && viewModel.qaState != .asking) || viewModel.qaState == .asking)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .background(Color(.systemBackground))
        }
    }

    // MARK: - Helper Functions

    private func jumpToTranscriptSegment(at timestamp: Double) {
        if let transcript = viewModel.transcript {
            let segment = transcript.segments.first { $0.startTime <= timestamp && $0.endTime >= timestamp }
            if let segment = segment {
                viewModel.selectSegment(segment)
                selectedTab = .transcript
            }
        }
    }

    // MARK: - Placeholder Views

    private func processingPlaceholder(message: String) -> some View {
        VStack(spacing: 16) {
            ProgressView()

            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private func emptyPlaceholder(message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "doc.text")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 60))
                .foregroundColor(.orange)

            VStack(spacing: 8) {
                Text("Failed to Load")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text(message)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await viewModel.loadRecording() }
            } label: {
                Label("Try Again", systemImage: "arrow.clockwise")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Detail Tab

enum DetailTab: String, CaseIterable, Identifiable {
    case summary
    case transcript
    case chat

    var id: String { rawValue }

    var title: String {
        switch self {
        case .summary: return "Summary"
        case .transcript: return "Transcript"
        case .chat: return "Chat"
        }
    }

    var icon: String {
        switch self {
        case .summary: return "list.bullet"
        case .transcript: return "doc.text"
        case .chat: return "bubble.left.and.bubble.right"
        }
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let status: RecordingStatus

    var body: some View {
        HStack(spacing: 4) {
            if status.isProcessing {
                ProgressView()
                    .scaleEffect(0.6)
            }

            Text(status.displayText)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(backgroundColor.opacity(0.15))
        .foregroundColor(backgroundColor)
        .cornerRadius(8)
    }

    private var backgroundColor: Color {
        switch status {
        case .completed:
            return .green
        case .failed:
            return .red
        case .uploading, .uploaded, .transcribing, .summarizing:
            return .orange
        case .pending, .transcribed:
            return .blue
        }
    }
}

// MARK: - Transcript Segment Row

struct TranscriptSegmentRow: View {
    let segment: TranscriptSegment
    let isSelected: Bool
    let formatTimestamp: (Double) -> String
    let speakerNames: [String: String]?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Timestamp
            Text(formatTimestamp(segment.startTime))
                .font(.caption)
                .fontWeight(.medium)
                .foregroundColor(.blue)
                .frame(width: 50, alignment: .leading)

            // Speaker and text
            VStack(alignment: .leading, spacing: 4) {
                if let speaker = segment.speaker {
                    Text(speaker.applyingSpeakerNames(speakerNames))
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)
                }

                Text(segment.text.applyingSpeakerNames(speakerNames))
                    .font(.body)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 4)
        .background(isSelected ? Color.blue.opacity(0.1) : Color.clear)
        .cornerRadius(8)
        .contentShape(Rectangle())
    }
}

// MARK: - Q&A Item View

struct QAItemView: View {
    let item: QAItem
    let isLatest: Bool
    let onCitationTap: (Citation) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Question
            HStack(alignment: .top) {
                Image(systemName: "person.circle.fill")
                    .font(.title2)
                    .foregroundColor(.blue)

                VStack(alignment: .leading, spacing: 4) {
                    Text("You")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    Text(item.question)
                        .font(.body)
                }
            }

            // Answer
            HStack(alignment: .top) {
                Image(systemName: "sparkles")
                    .font(.title2)
                    .foregroundColor(.purple)

                VStack(alignment: .leading, spacing: 8) {
                    Text("AI")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    Text(item.answer)
                        .font(.body)

                    // Citations
                    if !item.citations.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Sources:")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            ForEach(Array(item.citations.enumerated()), id: \.offset) { index, citation in
                                Button {
                                    onCitationTap(citation)
                                } label: {
                                    HStack(spacing: 4) {
                                        Text("[\(index + 1)]")
                                            .font(.caption)
                                            .fontWeight(.bold)

                                        Text(citation.text.prefix(50) + (citation.text.count > 50 ? "..." : ""))
                                            .font(.caption)
                                            .lineLimit(1)
                                    }
                                    .foregroundColor(.blue)
                                }
                            }
                        }
                        .padding(.top, 4)
                    }

                    // Confidence indicator
                    HStack(spacing: 4) {
                        Image(systemName: confidenceIcon)
                            .font(.caption)
                        Text(confidenceText)
                            .font(.caption)
                    }
                    .foregroundColor(confidenceColor)
                }
            }
        }
        .padding()
        .background(isLatest ? Color.purple.opacity(0.05) : Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var confidenceIcon: String {
        if item.confidence >= 0.8 {
            return "checkmark.circle.fill"
        } else if item.confidence >= 0.5 {
            return "circle.lefthalf.filled"
        } else {
            return "questionmark.circle"
        }
    }

    private var confidenceText: String {
        if item.confidence >= 0.8 {
            return "High confidence"
        } else if item.confidence >= 0.5 {
            return "Medium confidence"
        } else {
            return "Low confidence"
        }
    }

    private var confidenceColor: Color {
        if item.confidence >= 0.8 {
            return .green
        } else if item.confidence >= 0.5 {
            return .orange
        } else {
            return .red
        }
    }
}

// MARK: - Suggested Question Row

struct SuggestedQuestionRow: View {
    let text: String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack {
                Text(text)
                    .font(.body)
                    .foregroundColor(.primary)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Chat Message View

struct ChatMessageView: View {
    let item: QAItem
    let isLatest: Bool
    let onCitationTap: (Citation) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // User Question
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(Color.blue.opacity(0.1))
                    .frame(width: 32, height: 32)
                    .overlay(
                        Image(systemName: "person.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.blue)
                    )

                VStack(alignment: .leading, spacing: 4) {
                    Text("You")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    Text(item.question)
                        .font(.body)
                }

                Spacer()
            }

            // AI Answer
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(Color.purple.opacity(0.1))
                    .frame(width: 32, height: 32)
                    .overlay(
                        Image(systemName: "sparkles")
                            .font(.system(size: 14))
                            .foregroundColor(.purple)
                    )

                VStack(alignment: .leading, spacing: 8) {
                    Text("AI Assistant")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)

                    Text(item.answer)
                        .font(.body)

                    // Citations
                    if !item.citations.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Sources:")
                                .font(.caption)
                                .foregroundColor(.secondary)

                            ForEach(Array(item.citations.enumerated()), id: \.offset) { index, citation in
                                Button {
                                    onCitationTap(citation)
                                } label: {
                                    HStack(spacing: 4) {
                                        Text("[\(index + 1)]")
                                            .font(.caption)
                                            .fontWeight(.bold)

                                        Text(citation.text.prefix(50) + (citation.text.count > 50 ? "..." : ""))
                                            .font(.caption)
                                            .lineLimit(1)
                                    }
                                    .foregroundColor(.blue)
                                }
                            }
                        }
                        .padding(.top, 4)
                    }
                }

                Spacer()
            }
        }
        .padding()
        .background(isLatest ? Color.purple.opacity(0.05) : Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - Flow Layout (for topics)

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, subviews: subviews, spacing: spacing)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, subviews: subviews, spacing: spacing)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x,
                                      y: bounds.minY + result.positions[index].y),
                         proposal: .unspecified)
        }
    }

    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(in maxWidth: CGFloat, subviews: Subviews, spacing: CGFloat) {
            var currentX: CGFloat = 0
            var currentY: CGFloat = 0
            var lineHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if currentX + size.width > maxWidth && currentX > 0 {
                    currentX = 0
                    currentY += lineHeight + spacing
                    lineHeight = 0
                }

                positions.append(CGPoint(x: currentX, y: currentY))
                lineHeight = max(lineHeight, size.height)
                currentX += size.width + spacing
            }

            self.size = CGSize(width: maxWidth, height: currentY + lineHeight)
        }
    }
}

// MARK: - Live Segment Row

struct LiveSegmentRow: View {
    let segment: LiveTranscriptSegment
    let timestamp: String
    let colorIndex: Int

    private let speakerColors: [Color] = [
        .blue, .green, .purple, .orange, .pink, .teal, .indigo, .red
    ]

    private var speakerColor: Color {
        speakerColors[colorIndex % speakerColors.count]
    }

    private var speakerName: String {
        if let name = segment.speakerName, !name.isEmpty {
            return name
        }
        if let id = segment.speakerId {
            return "Speaker \(id)"
        }
        return "Unknown"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Timestamp
            Text(timestamp)
                .font(.caption)
                .foregroundColor(.gray)
                .frame(width: 40, alignment: .leading)

            // Content
            VStack(alignment: .leading, spacing: 4) {
                // Speaker badge
                HStack(spacing: 4) {
                    if segment.isHost {
                        Image(systemName: "crown.fill")
                            .font(.caption2)
                    }
                    Text(speakerName)
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .foregroundColor(speakerColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(speakerColor.opacity(0.15))
                .cornerRadius(8)

                // Transcript text
                Text(segment.segmentText)
                    .font(.body)
                    .foregroundColor(.primary)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Preview

#if DEBUG
struct RecordingDetailView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            RecordingDetailView(recordingId: "preview-id")
                .environmentObject(SummaryAIAPIClient())
        }
    }
}
#endif
