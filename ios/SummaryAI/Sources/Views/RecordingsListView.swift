import SwiftUI
import UniformTypeIdentifiers

// MARK: - Recording Filter

enum RecordingFilter: String, CaseIterable, Identifiable {
    case all
    case meetings
    case todos
    case favorites
    case imported

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .meetings: return "Meetings"
        case .todos: return "Todos"
        case .favorites: return "Favorites"
        case .imported: return "Imported"
        }
    }

    var icon: String {
        switch self {
        case .all: return "list.bullet"
        case .meetings: return "person.3.fill"
        case .todos: return "checklist"
        case .favorites: return "heart.fill"
        case .imported: return "square.and.arrow.down.fill"
        }
    }
}

// MARK: - Recordings List View

/// Wrapper to inject the API client from environment into the view model
struct RecordingsListView: View {
    @EnvironmentObject var apiClient: SummaryAIAPIClient

    var body: some View {
        RecordingsListContentView(apiClient: apiClient)
    }
}

/// Main list view displaying all recordings
struct RecordingsListContentView: View {
    let apiClient: SummaryAIAPIClient
    @StateObject private var viewModel: RecordingsListViewModel
    @StateObject private var calendarViewModel: CalendarViewModel
    @StateObject private var todosViewModel: TodosViewModel
    @State private var selectedRecording: Recording?
    @State private var selectedFilter: RecordingFilter = .all
    @State private var showNewRecordingSheet = false
    @State private var showRecordingView = false
    @State private var showVoiceTodoRecording = false
    @State private var showPaywall = false
    @State private var searchText = ""

    init(apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
        _viewModel = StateObject(wrappedValue: RecordingsListViewModel(apiClient: apiClient))
        _todosViewModel = StateObject(wrappedValue: TodosViewModel(apiClient: apiClient))
        _calendarViewModel = StateObject(wrappedValue: CalendarViewModel(apiClient: apiClient))
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Pending uploads banner — recordings that finished but
                // failed to upload. Shows above the filter tabs so the user
                // sees it before scrolling.
                PendingUploadsBanner()

                // Filter tabs
                filterTabsView

                // Search bar
                searchBarView

                // Content
                contentView
            }
            .navigationTitle("Meeting Mind")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    // PRO badge - only show for free users
                    if !PremiumManager.shared.isPremium {
                        Button {
                            showPaywall = true
                        } label: {
                            Text("PRO")
                                .font(.caption)
                                .fontWeight(.bold)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(Color.orange)
                                .foregroundColor(.white)
                                .cornerRadius(8)
                        }
                    }
                }
            }
            .navigationDestination(for: Recording.self) { recording in
                RecordingDetailView(recordingId: recording.id)
            }
            .safeAreaInset(edge: .bottom) {
                // New Summary button
                Button {
                    showNewRecordingSheet = true
                } label: {
                    Text("New Summary")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(16)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 8)
            }
        }
        .sheet(isPresented: $showNewRecordingSheet) {
            NewRecordingSheet(
                onRecordAudio: {
                    showNewRecordingSheet = false
                    // Delay to allow sheet to dismiss before presenting full screen cover
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        showRecordingView = true
                    }
                },
                onImportComplete: {
                    Task {
                        await viewModel.refreshRecordings()
                    }
                },
                onTodoList: {
                    // Switch to Todos tab and show voice recording
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        selectedFilter = .todos
                        showVoiceTodoRecording = true
                    }
                }
            )
            .environmentObject(apiClient)
            .presentationDetents([.height(320)])
            .presentationDragIndicator(.visible)
        }
        .fullScreenCover(isPresented: $showVoiceTodoRecording) {
            VoiceTodoRecordingView(viewModel: todosViewModel)
        }
        .fullScreenCover(isPresented: $showRecordingView) {
            NavigationStack {
                RecordingView()
                    .toolbar {
                        ToolbarItem(placement: .navigationBarLeading) {
                            Button("Cancel") {
                                showRecordingView = false
                            }
                        }
                    }
            }
        }
        .sheet(isPresented: $showPaywall) {
            RemotePaywallView(triggerSource: "recordings_list")
        }
        .task {
            await viewModel.loadRecordings()
            viewModel.startStatusPolling()
            await calendarViewModel.loadConnections()
            if calendarViewModel.hasConnectedCalendars {
                await calendarViewModel.loadMeetings()
            }
        }
        .onDisappear {
            viewModel.stopStatusPolling()
        }
        .alert("Error", isPresented: $viewModel.showError) {
            Button("Retry") {
                Task { await viewModel.loadRecordings() }
            }
            Button("Dismiss", role: .cancel) {
                viewModel.clearError()
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
    }

    // MARK: - Content View

    @ViewBuilder
    private var contentView: some View {
        switch selectedFilter {
        case .meetings:
            MeetingsView(viewModel: calendarViewModel)
        case .todos:
            TodosView(viewModel: todosViewModel)
        default:
            mainContentView
        }
    }

    @ViewBuilder
    private var mainContentView: some View {
        switch viewModel.state {
        case .idle, .loading:
            loadingView
        case .loaded:
            if filteredRecordings.isEmpty {
                emptyFilterStateView
            } else {
                recordingsListView
            }
        case .empty:
            emptyStateView
        case .error(let message):
            errorView(message: message)
        }
    }

    // MARK: - Filtered Recordings

    private var filteredRecordings: [Recording] {
        var recordings = viewModel.recordings

        // Apply filter
        switch selectedFilter {
        case .all:
            break
        case .meetings:
            recordings = recordings.filter { $0.recordingType == .meeting }
        case .todos:
            // Todos are handled separately in TodosView
            return []
        case .favorites:
            recordings = recordings.filter { $0.isFavorite == true }
        case .imported:
            recordings = recordings.filter { $0.recordingType == .imported }
        }

        // Apply search
        if !searchText.isEmpty {
            recordings = recordings.filter {
                $0.title.localizedCaseInsensitiveContains(searchText)
            }
        }

        return recordings
    }

    // MARK: - Filter Tabs View

    private var filterTabsView: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(RecordingFilter.allCases) { filter in
                    FilterTabButton(
                        title: filter.title,
                        isSelected: selectedFilter == filter
                    ) {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selectedFilter = filter
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color(.systemBackground))
    }

    // MARK: - Search Bar View

    private var searchBarView: some View {
        HStack(spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)

                TextField("Search", text: $searchText)
                    .textFieldStyle(.plain)

                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color(.secondarySystemBackground))
            .cornerRadius(10)

            // History button
            Button {
                // Show search history
            } label: {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.title3)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
            Text("Loading recordings...")
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Recordings List

    private var recordingsListView: some View {
        List {
            ForEach(filteredRecordings) { recording in
                NavigationLink(value: recording) {
                    RecordingRowView(
                        recording: recording,
                        onRename: { newTitle in
                            Task { await viewModel.renameRecording(recording, newTitle: newTitle) }
                        },
                        onToggleFavorite: {
                            Task { await viewModel.toggleFavorite(recording) }
                        },
                        onDelete: {
                            Task { await viewModel.deleteRecording(recording) }
                        }
                    )
                }
                .task {
                    await viewModel.loadMoreIfNeeded(currentItem: recording)
                }
            }
            .onDelete { offsets in
                Task { await viewModel.deleteRecordings(at: offsets) }
            }

            // Loading more indicator
            if viewModel.hasMorePages {
                HStack {
                    Spacer()
                    ProgressView()
                        .padding()
                    Spacer()
                }
                .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .refreshable {
            await viewModel.refreshRecordings()
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 24) {
            // Illustration placeholder
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.1))
                    .frame(width: 120, height: 120)

                Image(systemName: "waveform.circle")
                    .font(.system(size: 60))
                    .foregroundColor(.blue)
            }

            VStack(spacing: 8) {
                Text("Start your first recording")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Tap the button below to record, transcribe, and summarize your first meeting")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Empty Filter State

    private var emptyFilterStateView: some View {
        VStack(spacing: 24) {
            Image(systemName: selectedFilter.icon)
                .font(.system(size: 60))
                .foregroundColor(.secondary)

            VStack(spacing: 8) {
                Text("No \(selectedFilter.title) Found")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text(emptyFilterMessage)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyFilterMessage: String {
        switch selectedFilter {
        case .all:
            return "Start recording to see your summaries here"
        case .meetings:
            return "Recordings tagged as meetings will appear here"
        case .todos:
            return "Speak your todos or add them manually"
        case .favorites:
            return "Tap the heart icon on a recording to add it to favorites"
        case .imported:
            return "Import audio files or PDFs to see them here"
        }
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 60))
                .foregroundColor(.orange)

            VStack(spacing: 8) {
                Text("Something Went Wrong")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text(message)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            Button {
                Task { await viewModel.loadRecordings() }
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

// MARK: - Recording Row View

/// Individual row in the recordings list
struct RecordingRowView: View {
    let recording: Recording
    var onRename: ((String) -> Void)?
    var onToggleFavorite: (() -> Void)?
    var onDelete: (() -> Void)?

    @State private var showRenameAlert = false
    @State private var newTitle = ""
    @State private var showDeleteConfirmation = false

    var body: some View {
        HStack(spacing: 12) {
            // Status indicator
            statusIcon

            // Recording info
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(recording.title)
                        .font(.headline)
                        .lineLimit(1)

                    if recording.isFavorite == true {
                        Image(systemName: "heart.fill")
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }

                HStack(spacing: 8) {
                    // Date
                    Text(recording.createdAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption)
                        .foregroundColor(.secondary)

                    // Duration for audio, word count for documents
                    if recording.recordingType == .imported {
                        if let wordCount = recording.wordCount, wordCount > 0 {
                            Text("•")
                                .foregroundColor(.secondary)
                            Text("\(wordCount) words")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    } else if let duration = recording.durationSeconds {
                        Text("•")
                            .foregroundColor(.secondary)
                        Text(formatDuration(duration))
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                // Status badge
                statusBadge
            }

            Spacer()

            // More button
            if onRename != nil || onToggleFavorite != nil || onDelete != nil {
                Menu {
                    Button {
                        newTitle = recording.title
                        showRenameAlert = true
                    } label: {
                        Label("Rename", systemImage: "pencil")
                    }

                    Button {
                        onToggleFavorite?()
                    } label: {
                        Label(
                            recording.isFavorite == true ? "Remove from Favorites" : "Add to Favorites",
                            systemImage: recording.isFavorite == true ? "heart.slash" : "heart"
                        )
                    }

                    Divider()

                    Button(role: .destructive) {
                        showDeleteConfirmation = true
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16))
                        .foregroundColor(.secondary)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
        .alert("Rename Recording", isPresented: $showRenameAlert) {
            TextField("Title", text: $newTitle)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                if !newTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    onRename?(newTitle.trimmingCharacters(in: .whitespacesAndNewlines))
                }
            }
        } message: {
            Text("Enter a new title for this recording")
        }
        .confirmationDialog(
            "Delete Recording",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                onDelete?()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to delete \"\(recording.title)\"? This action cannot be undone.")
        }
    }

    // MARK: - Status Icon

    @ViewBuilder
    private var statusIcon: some View {
        ZStack {
            Circle()
                .fill(statusBackgroundColor)
                .frame(width: 44, height: 44)

            if recording.status.isProcessing {
                ProgressView()
                    .scaleEffect(0.8)
            } else {
                Image(systemName: statusIconName)
                    .font(.system(size: 18))
                    .foregroundColor(statusIconColor)
            }
        }
    }

    private var statusIconName: String {
        // Show document icon for imported files (PDFs)
        if recording.recordingType == .imported {
            switch recording.status {
            case .completed:
                return "doc.text.fill"
            case .failed:
                return "exclamationmark.circle.fill"
            default:
                return "doc.fill"
            }
        }

        // Regular audio recordings
        switch recording.status {
        case .completed:
            return "checkmark.circle.fill"
        case .failed:
            return "exclamationmark.circle.fill"
        case .transcribed:
            return "text.alignleft"
        default:
            return "waveform"
        }
    }

    private var statusIconColor: Color {
        switch recording.status {
        case .completed:
            return .green
        case .failed:
            return .red
        default:
            return .blue
        }
    }

    private var statusBackgroundColor: Color {
        switch recording.status {
        case .completed:
            return .green.opacity(0.15)
        case .failed:
            return .red.opacity(0.15)
        default:
            return .blue.opacity(0.15)
        }
    }

    // MARK: - Status Badge

    @ViewBuilder
    private var statusBadge: some View {
        if recording.status != .completed {
            HStack(spacing: 4) {
                if recording.status.isProcessing {
                    ProgressView()
                        .scaleEffect(0.5)
                }

                Text(recording.status.displayText)
                    .font(.caption2)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(statusBadgeColor.opacity(0.15))
            .foregroundColor(statusBadgeColor)
            .cornerRadius(4)
        }
    }

    private var statusBadgeColor: Color {
        switch recording.status {
        case .completed:
            return .green
        case .failed:
            return .red
        case .pending, .uploading, .uploaded, .transcribing, .summarizing:
            return .orange
        case .transcribed:
            return .blue
        }
    }

    // MARK: - Helpers

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        } else {
            return String(format: "%d:%02d", minutes, secs)
        }
    }
}

// MARK: - Filter Tab Button

struct FilterTabButton: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isSelected ? Color.blue : Color(.secondarySystemBackground))
                .foregroundColor(isSelected ? .white : .primary)
                .cornerRadius(20)
        }
    }
}

// MARK: - New Recording Sheet

struct NewRecordingSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var apiClient: SummaryAIAPIClient
    @State private var showFilePicker = false
    @State private var isUploading = false
    @State private var uploadProgress: Double = 0
    @State private var showError = false
    @State private var errorMessage = ""

    let onRecordAudio: () -> Void
    var onImportComplete: (() -> Void)?
    var onTodoList: (() -> Void)?

    var body: some View {
        NavigationStack {
            ZStack {
                VStack(spacing: 16) {
                    // Record Audio option
                    NewRecordingOptionRow(
                        icon: "mic.fill",
                        iconColor: .blue,
                        title: "Record Audio",
                        subtitle: nil
                    ) {
                        onRecordAudio()
                    }
                    .disabled(isUploading)

                    // Upload from files option
                    NewRecordingOptionRow(
                        icon: "square.and.arrow.up.fill",
                        iconColor: .blue,
                        title: "Upload from files",
                        subtitle: "PDF and Recordings"
                    ) {
                        showFilePicker = true
                    }
                    .disabled(isUploading)

                    // To-Do List option
                    NewRecordingOptionRow(
                        icon: "checklist",
                        iconColor: .green,
                        title: "To-Do List",
                        subtitle: "Tasks, To-Dos and Notes"
                    ) {
                        dismiss()
                        onTodoList?()
                    }
                    .disabled(isUploading)

                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .opacity(isUploading ? 0.5 : 1.0)

                // Upload progress overlay
                if isUploading {
                    VStack(spacing: 16) {
                        ProgressView(value: uploadProgress)
                            .progressViewStyle(.linear)
                            .frame(width: 200)

                        Text("Uploading... \(Int(uploadProgress * 100))%")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(24)
                    .background(Color(.systemBackground))
                    .cornerRadius(16)
                    .shadow(radius: 10)
                }
            }
            .fileImporter(
                isPresented: $showFilePicker,
                allowedContentTypes: [.audio, .pdf, .mpeg4Audio, .mp3],
                allowsMultipleSelection: false
            ) { result in
                switch result {
                case .success(let urls):
                    if let url = urls.first {
                        Task {
                            await importFile(url: url)
                        }
                    }
                case .failure(let error):
                    errorMessage = error.localizedDescription
                    showError = true
                }
            }
            .alert("Import Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
        }
    }

    private func importFile(url: URL) async {
        isUploading = true
        uploadProgress = 0

        do {
            let _ = try await apiClient.importFile(fileURL: url) { progress in
                DispatchQueue.main.async {
                    self.uploadProgress = progress.fractionCompleted
                }
            }

            await MainActor.run {
                isUploading = false
                onImportComplete?()
                dismiss()
            }
        } catch {
            await MainActor.run {
                isUploading = false
                errorMessage = error.localizedDescription
                showError = true
            }
        }
    }
}

// MARK: - New Recording Option Row

struct NewRecordingOptionRow: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                // Icon
                ZStack {
                    Circle()
                        .fill(iconColor)
                        .frame(width: 44, height: 44)

                    Image(systemName: icon)
                        .font(.system(size: 18))
                        .foregroundColor(.white)
                }

                // Text
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.body)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    if let subtitle = subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }
    }
}

// MARK: - Preview

#if DEBUG
struct RecordingsListView_Previews: PreviewProvider {
    static var previews: some View {
        RecordingsListView()
            .environmentObject(SummaryAIAPIClient())
    }
}

struct NewRecordingSheet_Previews: PreviewProvider {
    static var previews: some View {
        NewRecordingSheet(onRecordAudio: {})
            .environmentObject(SummaryAIAPIClient())
    }
}
#endif

// MARK: - Pending Uploads Banner

/// Banner that surfaces recordings whose upload failed. Driven by
/// BackgroundUploadManager so it picks up failures across app launches.
private struct PendingUploadsBanner: View {
    @StateObject private var manager = BackgroundUploadManager.shared

    var body: some View {
        let failed = manager.pendingUploads.filter { $0.status == .failed }
        if !failed.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(failed.count == 1
                     ? "1 recording didn't upload"
                     : "\(failed.count) recordings didn't upload")
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                Text("Tap retry — they're saved on your device.")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.9))
                ForEach(failed) { pending in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pending.title)
                                .font(.callout)
                                .foregroundColor(.white)
                                .lineLimit(1)
                            Text("\(formatDuration(pending.durationSeconds)) • \(pending.fileSize / 1024 / 1024) MB")
                                .font(.caption2)
                                .foregroundColor(.white.opacity(0.85))
                        }
                        Spacer()
                        Button("Discard") { manager.discard(pending) }
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.white.opacity(0.9))
                        Button("Retry") { manager.retry(pending) }
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.white.opacity(0.25))
                            .cornerRadius(8)
                            .foregroundColor(.white)
                    }
                }
            }
            .padding(12)
            .background(Color.red.opacity(0.9))
            .cornerRadius(12)
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
    }

    private func formatDuration(_ seconds: Int) -> String {
        if seconds <= 0 { return "—" }
        let h = seconds / 3600
        let m = (seconds % 3600) / 60
        let s = seconds % 60
        if h > 0 { return "\(h)h \(m)m" }
        if m > 0 { return "\(m)m \(s)s" }
        return "\(s)s"
    }
}
