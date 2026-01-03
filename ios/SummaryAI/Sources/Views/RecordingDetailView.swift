import SwiftUI

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
    @State private var selectedTab: DetailTab = .summary
    @State private var showShareSheet = false
    @State private var showDeleteConfirmation = false

    init(recordingId: String, apiClient: SummaryAIAPIClient) {
        _viewModel = StateObject(wrappedValue: RecordingDetailViewModel(recordingId: recordingId, apiClient: apiClient))
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
        }
        .onDisappear {
            viewModel.stopStatusPolling()
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
                    transcript: viewModel.transcript
                ) {
                    showShareSheet = false
                }
                .presentationDetents([.medium])
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

            // Tab picker
            Picker("Section", selection: $selectedTab) {
                ForEach(DetailTab.allCases) { tab in
                    Text(tab.title).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding()

            // Tab content
            TabView(selection: $selectedTab) {
                summaryTabView
                    .tag(DetailTab.summary)

                transcriptTabView
                    .tag(DetailTab.transcript)

                qaTabView
                    .tag(DetailTab.qa)
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
            ProgressView()
                .scaleEffect(0.8)

            Text(viewModel.recording?.status.displayText ?? "Processing...")
                .font(.subheadline)

            Spacer()
        }
        .padding()
        .background(Color.orange.opacity(0.15))
        .foregroundColor(.orange)
    }

    // MARK: - Summary Tab

    private var summaryTabView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Recording metadata
                metadataSection

                if let summary = viewModel.summary {
                    // Summary text
                    summarySection(summary)

                    // Key points
                    if !summary.keyPoints.isEmpty {
                        keyPointsSection(summary.keyPoints)
                    }

                    // Action items
                    if let actionItems = summary.actionItems, !actionItems.isEmpty {
                        actionItemsSection(actionItems)
                    }

                    // Topics
                    if let topics = summary.topics, !topics.isEmpty {
                        topicsSection(topics)
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
        VStack(alignment: .leading, spacing: 8) {
            Text("Summary")
                .font(.headline)

            Text(summary.summary)
                .font(.body)
                .foregroundColor(.primary)
        }
    }

    private func keyPointsSection(_ keyPoints: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Key Points")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(keyPoints, id: \.self) { point in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.subheadline)

                        Text(point)
                            .font(.body)
                    }
                }
            }
        }
    }

    private func actionItemsSection(_ actionItems: [ActionItem]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Action Items")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(actionItems) { item in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "square")
                            .foregroundColor(.blue)
                            .font(.subheadline)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.task)
                                .font(.body)

                            if let assignee = item.assignee {
                                Text("Assigned to: \(assignee)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
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
        Group {
            if let transcript = viewModel.transcript, !transcript.segments.isEmpty {
                ScrollViewReader { proxy in
                    List {
                        ForEach(Array(transcript.segments.enumerated()), id: \.element.id) { index, segment in
                            TranscriptSegmentRow(
                                segment: segment,
                                isSelected: viewModel.selectedSegment?.id == segment.id,
                                formatTimestamp: viewModel.formatTimestamp
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

    // MARK: - Q&A Tab

    private var qaTabView: some View {
        VStack(spacing: 0) {
            // Q&A History
            if viewModel.qaHistory.isEmpty && viewModel.currentAnswer == nil {
                emptyQAPlaceholder
            } else {
                qaHistoryList
            }

            Divider()

            // Question input
            questionInputSection
        }
    }

    private var emptyQAPlaceholder: some View {
        VStack(spacing: 16) {
            Image(systemName: "questionmark.bubble")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("Ask Questions")
                .font(.headline)

            Text("Ask questions about this recording and get AI-powered answers based on the transcript.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var qaHistoryList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 16) {
                    // Current answer (if any)
                    if let currentAnswer = viewModel.currentAnswer {
                        QAItemView(
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
                        QAItemView(
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

    private var questionInputSection: some View {
        VStack(spacing: 8) {
            if !viewModel.canAskQuestions {
                Text("Questions available after transcription is complete")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            HStack(spacing: 12) {
                TextField("Ask a question...", text: $viewModel.questionText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...3)
                    .disabled(!viewModel.canAskQuestions || viewModel.qaState == .asking)

                Button {
                    Task { await viewModel.askQuestion() }
                } label: {
                    if viewModel.qaState == .asking {
                        ProgressView()
                            .frame(width: 24, height: 24)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 28))
                    }
                }
                .disabled(!viewModel.canAskQuestions || viewModel.questionText.isEmpty || viewModel.qaState == .asking)
            }
        }
        .padding()
        .background(Color(.systemBackground))
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
    case qa

    var id: String { rawValue }

    var title: String {
        switch self {
        case .summary: return "Summary"
        case .transcript: return "Transcript"
        case .qa: return "Q&A"
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
                    Text(speaker)
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)
                }

                Text(segment.text)
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

// MARK: - Audio Player View

/// Full-featured audio player with scrubber and speed control
struct AudioPlayerView: View {
    let audioURL: URL?
    let duration: TimeInterval
    let onSeek: ((TimeInterval) -> Void)?

    @State private var isPlaying = false
    @State private var currentTime: TimeInterval = 0
    @State private var playbackSpeed: Float = 1.0

    init(audioURL: URL?, duration: TimeInterval, onSeek: ((TimeInterval) -> Void)? = nil) {
        self.audioURL = audioURL
        self.duration = duration
        self.onSeek = onSeek
    }

    var body: some View {
        VStack(spacing: 12) {
            // Progress slider
            VStack(spacing: 4) {
                Slider(value: $currentTime, in: 0...max(duration, 1)) { editing in
                    if !editing {
                        onSeek?(currentTime)
                    }
                }
                .tint(.blue)

                // Time labels
                HStack {
                    Text(formatTime(currentTime))
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .monospacedDigit()

                    Spacer()

                    Text(formatTime(duration))
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .monospacedDigit()
                }
            }

            // Controls
            HStack(spacing: 24) {
                // Playback speed
                Menu {
                    Button("0.5x") { playbackSpeed = 0.5 }
                    Button("0.75x") { playbackSpeed = 0.75 }
                    Button("1x") { playbackSpeed = 1.0 }
                    Button("1.25x") { playbackSpeed = 1.25 }
                    Button("1.5x") { playbackSpeed = 1.5 }
                    Button("2x") { playbackSpeed = 2.0 }
                } label: {
                    Text(String(format: "%.2gx", playbackSpeed))
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.gray.opacity(0.15))
                        .cornerRadius(4)
                }

                Spacer()

                // Skip backward
                Button {
                    currentTime = max(0, currentTime - 15)
                    onSeek?(currentTime)
                } label: {
                    Image(systemName: "gobackward.15")
                        .font(.title2)
                        .foregroundColor(.primary)
                }

                // Play/Pause
                Button {
                    isPlaying.toggle()
                } label: {
                    ZStack {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 56, height: 56)

                        Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                            .font(.title2)
                            .foregroundColor(.white)
                            .offset(x: isPlaying ? 0 : 2)
                    }
                }

                // Skip forward
                Button {
                    currentTime = min(duration, currentTime + 15)
                    onSeek?(currentTime)
                } label: {
                    Image(systemName: "goforward.15")
                        .font(.title2)
                        .foregroundColor(.primary)
                }

                Spacer()

                // Download button
                Button {
                    // Handle download
                } label: {
                    Image(systemName: "square.and.arrow.down")
                        .font(.title3)
                        .foregroundColor(.primary)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(16)
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Share Export View

/// Bottom sheet for sharing/exporting recording content
struct ShareExportView: View {
    let recording: Recording
    let summary: RecordingSummary?
    let transcript: Transcript?
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Share or Export")
                    .font(.headline)

                Spacer()

                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
            }
            .padding()

            Divider()

            // Export options
            ScrollView {
                VStack(spacing: 12) {
                    ShareOptionRow(icon: "doc.fill", title: "Share Summary as PDF") {
                        // Export summary as PDF
                        onDismiss()
                    }
                    .disabled(summary == nil)
                    .opacity(summary == nil ? 0.5 : 1)

                    ShareOptionRow(icon: "doc.text.fill", title: "Share Summary as Text") {
                        // Export summary as text
                        onDismiss()
                    }
                    .disabled(summary == nil)
                    .opacity(summary == nil ? 0.5 : 1)

                    ShareOptionRow(icon: "doc.fill", title: "Share Transcript as PDF") {
                        // Export transcript as PDF
                        onDismiss()
                    }
                    .disabled(transcript == nil)
                    .opacity(transcript == nil ? 0.5 : 1)

                    ShareOptionRow(icon: "doc.text.fill", title: "Share Transcript as Text") {
                        // Export transcript as text
                        onDismiss()
                    }
                    .disabled(transcript == nil)
                    .opacity(transcript == nil ? 0.5 : 1)

                    ShareOptionRow(icon: "waveform", title: "Share Audio") {
                        // Share audio file
                        onDismiss()
                    }
                }
                .padding()
            }

            // Tip
            HStack(spacing: 8) {
                Image(systemName: "lightbulb.fill")
                    .foregroundColor(.yellow)

                Text("Share or export with just a tap!")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
        }
    }
}

// MARK: - Share Option Row

struct ShareOptionRow: View {
    let icon: String
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(Color.gray.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: icon)
                        .font(.system(size: 18))
                        .foregroundColor(.primary)
                }

                Text(title)
                    .font(.body)
                    .foregroundColor(.primary)

                Spacer()
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }
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
