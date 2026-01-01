import Foundation
import Combine

// MARK: - List View State

/// Represents the loading state of the recordings list
enum RecordingsListState: Equatable {
    case idle
    case loading
    case loaded
    case empty
    case error(String)

    var isLoading: Bool {
        self == .loading
    }

    var isError: Bool {
        if case .error = self { return true }
        return false
    }
}

// MARK: - Recordings List View Model

/// View model for the recordings list screen
@MainActor
final class RecordingsListViewModel: ObservableObject {

    // MARK: - Published Properties

    @Published private(set) var recordings: [Recording] = []
    @Published private(set) var state: RecordingsListState = .idle
    @Published private(set) var isRefreshing: Bool = false
    @Published private(set) var hasMorePages: Bool = true

    /// Error message to display
    @Published var errorMessage: String?
    @Published var showError: Bool = false

    // MARK: - Pagination

    private var currentPage: Int = 1
    private let perPage: Int = 20
    private var totalCount: Int = 0
    private var isLoadingMore: Bool = false

    // MARK: - Dependencies

    private let apiClient: SummaryAIAPIClient
    private var refreshTask: Task<Void, Never>?
    private var pollingTask: Task<Void, Never>?

    // MARK: - Initialization

    init(apiClient: SummaryAIAPIClient = SummaryAIAPIClient()) {
        self.apiClient = apiClient
    }

    deinit {
        refreshTask?.cancel()
        pollingTask?.cancel()
    }

    // MARK: - Data Loading

    /// Load recordings (initial load or refresh)
    func loadRecordings() async {
        guard state != .loading else { return }

        state = .loading
        currentPage = 1

        do {
            let response = try await apiClient.getRecordings(page: 1, perPage: perPage)

            recordings = response.recordings
            totalCount = response.pagination.totalCount
            hasMorePages = response.pagination.hasMore

            state = recordings.isEmpty ? .empty : .loaded

        } catch {
            handleError(error)
        }
    }

    /// Refresh recordings (pull-to-refresh)
    func refreshRecordings() async {
        guard !isRefreshing else { return }

        isRefreshing = true

        do {
            let response = try await apiClient.getRecordings(page: 1, perPage: perPage)

            recordings = response.recordings
            totalCount = response.pagination.totalCount
            currentPage = 1
            hasMorePages = response.pagination.hasMore

            state = recordings.isEmpty ? .empty : .loaded

        } catch {
            // Don't change state on refresh error, just show error
            showError(error.localizedDescription)
        }

        isRefreshing = false
    }

    /// Load more recordings (pagination)
    func loadMoreIfNeeded(currentItem: Recording) async {
        // Check if we're at the last item
        guard let lastItem = recordings.last,
              lastItem.id == currentItem.id,
              hasMorePages,
              !isLoadingMore else {
            return
        }

        isLoadingMore = true
        let nextPage = currentPage + 1

        do {
            let response = try await apiClient.getRecordings(page: nextPage, perPage: perPage)

            recordings.append(contentsOf: response.recordings)
            currentPage = nextPage
            hasMorePages = response.pagination.hasMore

        } catch {
            // Silently fail for pagination errors
            print("[RecordingsListViewModel] Failed to load more: \(error)")
        }

        isLoadingMore = false
    }

    // MARK: - Recording Actions

    /// Delete a recording
    func deleteRecording(_ recording: Recording) async {
        do {
            try await apiClient.deleteRecording(id: recording.id)

            // Remove from local list
            recordings.removeAll { $0.id == recording.id }

            if recordings.isEmpty {
                state = .empty
            }

        } catch {
            showError("Failed to delete recording: \(error.localizedDescription)")
        }
    }

    /// Delete recordings at index set (for swipe-to-delete)
    func deleteRecordings(at offsets: IndexSet) async {
        let recordingsToDelete = offsets.map { recordings[$0] }

        for recording in recordingsToDelete {
            await deleteRecording(recording)
        }
    }

    // MARK: - Status Polling

    /// Start polling for status updates on processing recordings
    func startStatusPolling() {
        pollingTask?.cancel()

        pollingTask = Task {
            while !Task.isCancelled {
                // Wait 5 seconds between polls
                try? await Task.sleep(nanoseconds: 5_000_000_000)

                guard !Task.isCancelled else { break }

                // Check if any recordings are still processing
                let processingIds = recordings
                    .filter { $0.status.isProcessing }
                    .map { $0.id }

                guard !processingIds.isEmpty else {
                    // No processing recordings, stop polling
                    break
                }

                // Refresh to get updated statuses
                await refreshRecordingsQuietly()
            }
        }
    }

    /// Stop status polling
    func stopStatusPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    /// Refresh without UI feedback (for background polling)
    private func refreshRecordingsQuietly() async {
        do {
            let response = try await apiClient.getRecordings(page: 1, perPage: max(recordings.count, perPage))

            // Update recordings while preserving order
            let updatedRecordings = response.recordings
            recordings = updatedRecordings

        } catch {
            // Silently ignore polling errors
            print("[RecordingsListViewModel] Quiet refresh failed: \(error)")
        }
    }

    // MARK: - Error Handling

    private func handleError(_ error: Error) {
        let message: String
        if let apiError = error as? APIError {
            message = apiError.userMessage
        } else {
            message = error.localizedDescription
        }

        state = .error(message)
        showError(message)
    }

    private func showError(_ message: String) {
        errorMessage = message
        showError = true
    }

    func clearError() {
        errorMessage = nil
        showError = false
        if case .error = state {
            state = .idle
        }
    }

    // MARK: - Helpers

    /// Get recording at index safely
    func recording(at index: Int) -> Recording? {
        guard index >= 0 && index < recordings.count else { return nil }
        return recordings[index]
    }

    /// Check if a recording needs refresh (still processing)
    func needsRefresh(_ recording: Recording) -> Bool {
        recording.status.isProcessing
    }
}

// MARK: - Recording Status Extension

extension RecordingStatus {
    /// Whether this status indicates the recording is still being processed
    var isProcessing: Bool {
        switch self {
        case .uploading, .uploaded, .transcribing, .summarizing:
            return true
        case .pending, .transcribed, .completed, .failed:
            return false
        }
    }

    /// User-friendly display text
    var displayText: String {
        switch self {
        case .pending:
            return "Pending"
        case .uploading:
            return "Uploading..."
        case .uploaded:
            return "Processing..."
        case .transcribing:
            return "Transcribing..."
        case .transcribed:
            return "Transcribed"
        case .summarizing:
            return "Summarizing..."
        case .completed:
            return "Ready"
        case .failed:
            return "Failed"
        }
    }

    /// Status color for UI
    var displayColor: String {
        switch self {
        case .completed:
            return "green"
        case .failed:
            return "red"
        case .uploading, .uploaded, .transcribing, .summarizing:
            return "orange"
        case .pending, .transcribed:
            return "blue"
        }
    }
}
