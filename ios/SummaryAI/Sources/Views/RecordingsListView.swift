import SwiftUI

// MARK: - Recordings List View

/// Main list view displaying all recordings
struct RecordingsListView: View {
    @StateObject private var viewModel = RecordingsListViewModel()
    @State private var selectedRecording: Recording?

    var body: some View {
        NavigationStack {
            Group {
                switch viewModel.state {
                case .idle, .loading:
                    loadingView

                case .loaded:
                    recordingsListView

                case .empty:
                    emptyStateView

                case .error(let message):
                    errorView(message: message)
                }
            }
            .navigationTitle("Recordings")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    NavigationLink {
                        RecordingView()
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title2)
                    }
                }
            }
            .navigationDestination(for: Recording.self) { recording in
                RecordingDetailView(recordingId: recording.id)
            }
        }
        .task {
            await viewModel.loadRecordings()
            viewModel.startStatusPolling()
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
            ForEach(viewModel.recordings) { recording in
                NavigationLink(value: recording) {
                    RecordingRowView(recording: recording)
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
            Image(systemName: "waveform.circle")
                .font(.system(size: 80))
                .foregroundColor(.secondary)

            VStack(spacing: 8) {
                Text("No Recordings Yet")
                    .font(.title2)
                    .fontWeight(.semibold)

                Text("Tap the + button to create your first recording")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            NavigationLink {
                RecordingView()
            } label: {
                Label("New Recording", systemImage: "mic.fill")
                    .font(.headline)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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

    var body: some View {
        HStack(spacing: 12) {
            // Status indicator
            statusIcon

            // Recording info
            VStack(alignment: .leading, spacing: 4) {
                Text(recording.title)
                    .font(.headline)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    // Date
                    Text(recording.createdAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption)
                        .foregroundColor(.secondary)

                    // Duration
                    if let duration = recording.durationSeconds {
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

            // Chevron is automatic with NavigationLink
        }
        .padding(.vertical, 4)
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
        case .uploading, .uploaded, .transcribing, .summarizing:
            return .orange
        case .pending, .transcribed:
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

// MARK: - Preview

#if DEBUG
struct RecordingsListView_Previews: PreviewProvider {
    static var previews: some View {
        RecordingsListView()
    }
}
#endif
