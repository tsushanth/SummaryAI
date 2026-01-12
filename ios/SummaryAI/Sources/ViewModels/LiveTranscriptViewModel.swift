import Foundation
import Combine

/// View model for live transcript during meeting recording
@MainActor
final class LiveTranscriptViewModel: ObservableObject {

    // MARK: - Published Properties

    @Published private(set) var segments: [LiveTranscriptSegment] = []
    @Published private(set) var isLoading: Bool = false
    @Published private(set) var error: String?
    @Published private(set) var hasMore: Bool = false

    // MARK: - Properties

    private var meetingId: String
    private let apiClient: SummaryAIAPIClient
    private var pollingTask: Task<Void, Never>?
    private var lastFetchTime: Date?

    /// Unique speaker IDs seen so far for color assignment
    private var speakerColorMap: [String: Int] = [:]
    private var nextColorIndex: Int = 0

    // MARK: - Initialization

    init(meetingId: String, apiClient: SummaryAIAPIClient) {
        self.meetingId = meetingId
        self.apiClient = apiClient
    }

    /// Update the meeting ID (used when recording loads and reveals its meeting ID)
    func updateMeetingId(_ newMeetingId: String) {
        guard newMeetingId != meetingId, !newMeetingId.isEmpty else { return }
        meetingId = newMeetingId
        reset()
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Public Methods

    /// Start polling for live transcript updates
    func startPolling() {
        pollingTask?.cancel()

        pollingTask = Task {
            // Initial fetch
            await fetchTranscript()

            // Poll every 2 seconds
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)

                guard !Task.isCancelled else { break }

                await fetchTranscript()
            }
        }
    }

    /// Stop polling
    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    /// Clear all segments and reset
    func reset() {
        segments = []
        lastFetchTime = nil
        speakerColorMap = [:]
        nextColorIndex = 0
    }

    // MARK: - Private Methods

    private func fetchTranscript() async {
        do {
            let response = try await apiClient.getLiveTranscript(
                meetingId: meetingId,
                since: lastFetchTime
            )

            // Merge new segments (avoid duplicates)
            let existingIds = Set(segments.map { $0.id })
            let newSegments = response.segments.filter { !existingIds.contains($0.id) }

            if !newSegments.isEmpty {
                // Update last fetch time
                if let lastSegment = newSegments.last {
                    lastFetchTime = lastSegment.createdAt
                }

                // Append and sort by timestamp
                segments.append(contentsOf: newSegments)
                segments.sort { $0.startTimestamp < $1.startTimestamp }
            }

            hasMore = response.hasMore
            error = nil

        } catch {
            // Don't show error for normal polling failures
            print("[LiveTranscript] Fetch error: \(error)")
        }
    }

    // MARK: - Helper Methods

    /// Get a consistent color index for a speaker
    func colorIndex(for speakerId: String?) -> Int {
        guard let speakerId = speakerId else { return 0 }

        if let existing = speakerColorMap[speakerId] {
            return existing
        }

        let index = nextColorIndex
        speakerColorMap[speakerId] = index
        nextColorIndex += 1
        return index
    }

    /// Format timestamp as mm:ss
    func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
