import Foundation
import Combine

// MARK: - Search Result

/// Represents a search result with matching context
struct SearchResult: Identifiable, Equatable {
    let id: String
    let recording: Recording
    let matchingSegments: [MatchingSegment]
    let matchCount: Int

    static func == (lhs: SearchResult, rhs: SearchResult) -> Bool {
        lhs.id == rhs.id && lhs.matchCount == rhs.matchCount
    }
}

/// A transcript segment that matches the search query
struct MatchingSegment: Identifiable, Equatable {
    let id: String
    let segmentId: String
    let text: String
    let highlightedText: AttributedString
    let startTime: Double
    let speaker: String?

    static func == (lhs: MatchingSegment, rhs: MatchingSegment) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Search State

enum SearchState: Equatable {
    case idle
    case searching
    case results
    case empty
    case error(String)
}

// MARK: - Search View Model

/// View model for searching across recordings and transcripts
///
/// **Design Decision: Client-Side Search for v1**
///
/// For v1, we implement client-side search by:
/// 1. Fetching all recordings with their transcripts
/// 2. Performing keyword matching locally
///
/// **Justification:**
/// - Simpler implementation without backend changes
/// - Works offline once data is cached
/// - Acceptable performance for <1000 recordings (typical user)
/// - Avoids adding search infrastructure (Elasticsearch, etc.)
///
/// **Future Improvements (v2):**
/// - Server-side full-text search with PostgreSQL tsvector
/// - Semantic search with embeddings
/// - Search indexing for large datasets
///
@MainActor
final class SearchViewModel: ObservableObject {

    // MARK: - Published Properties

    @Published var searchQuery: String = ""
    @Published private(set) var results: [SearchResult] = []
    @Published private(set) var state: SearchState = .idle
    @Published private(set) var recentSearches: [String] = []

    // MARK: - Private Properties

    private let apiClient: SummaryAIAPIClient
    private var searchTask: Task<Void, Never>?
    private var cancellables = Set<AnyCancellable>()

    /// Cache of recordings with transcripts
    private var cachedRecordings: [(Recording, Transcript?)] = []
    private var lastCacheUpdate: Date?
    private let cacheValidityDuration: TimeInterval = 300 // 5 minutes

    // MARK: - Constants

    private let maxRecentSearches = 10
    private let minQueryLength = 2
    private let searchDebounceMs: Int = 300

    // MARK: - Initialization

    init(apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
        loadRecentSearches()
        setupSearchDebounce()
    }

    // MARK: - Setup

    private func setupSearchDebounce() {
        $searchQuery
            .debounce(for: .milliseconds(searchDebounceMs), scheduler: DispatchQueue.main)
            .removeDuplicates()
            .sink { [weak self] query in
                Task {
                    await self?.performSearch(query: query)
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Search

    /// Perform search with the given query
    func performSearch(query: String) async {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        // Reset if query is too short
        guard trimmedQuery.count >= minQueryLength else {
            results = []
            state = .idle
            return
        }

        // Cancel any existing search
        searchTask?.cancel()

        state = .searching

        searchTask = Task {
            do {
                // Refresh cache if needed
                if shouldRefreshCache() {
                    try await refreshCache()
                }

                guard !Task.isCancelled else { return }

                // Perform local search
                let searchResults = searchLocally(query: trimmedQuery)

                guard !Task.isCancelled else { return }

                results = searchResults
                state = searchResults.isEmpty ? .empty : .results

                // Save to recent searches
                saveRecentSearch(query)

            } catch {
                if !Task.isCancelled {
                    state = .error(error.localizedDescription)
                }
            }
        }
    }

    /// Clear current search
    func clearSearch() {
        searchQuery = ""
        results = []
        state = .idle
    }

    /// Search with a recent query
    func searchRecent(_ query: String) {
        searchQuery = query
    }

    /// Clear recent searches
    func clearRecentSearches() {
        recentSearches = []
        UserDefaults.standard.removeObject(forKey: "recentSearches")
    }

    // MARK: - Cache Management

    private func shouldRefreshCache() -> Bool {
        guard let lastUpdate = lastCacheUpdate else { return true }
        return Date().timeIntervalSince(lastUpdate) > cacheValidityDuration
    }

    private func refreshCache() async throws {
        // Fetch all recordings
        var allRecordings: [Recording] = []
        var page = 1
        var hasMore = true

        while hasMore {
            let response = try await apiClient.getRecordings(page: page, perPage: 50)
            allRecordings.append(contentsOf: response.recordings)
            hasMore = response.pagination.hasMore
            page += 1

            // Limit to prevent excessive fetching
            if page > 20 { break }
        }

        // Fetch transcripts for completed recordings
        var recordingsWithTranscripts: [(Recording, Transcript?)] = []

        for recording in allRecordings {
            if recording.status == .completed || recording.status == .transcribed {
                do {
                    let detail = try await apiClient.getRecording(
                        id: recording.id,
                        includeTranscript: true,
                        includeSummary: false
                    )
                    recordingsWithTranscripts.append((detail.recording, detail.transcript))
                } catch {
                    // Include recording without transcript on error
                    recordingsWithTranscripts.append((recording, nil))
                }
            } else {
                recordingsWithTranscripts.append((recording, nil))
            }
        }

        cachedRecordings = recordingsWithTranscripts
        lastCacheUpdate = Date()
    }

    // MARK: - Local Search

    private func searchLocally(query: String) -> [SearchResult] {
        let keywords = query.components(separatedBy: .whitespaces).filter { !$0.isEmpty }

        var searchResults: [SearchResult] = []

        for (recording, transcript) in cachedRecordings {
            var matchingSegments: [MatchingSegment] = []

            // Search in recording title
            let titleMatches = recording.title.lowercased().contains(query)

            // Search in transcript segments
            if let transcript = transcript {
                for segment in transcript.segments {
                    let text = segment.text.lowercased()

                    // Check if segment contains all keywords (AND search)
                    let matchesAllKeywords = keywords.allSatisfy { text.contains($0) }

                    if matchesAllKeywords {
                        let highlighted = highlightMatches(
                            in: segment.text,
                            keywords: keywords
                        )

                        matchingSegments.append(MatchingSegment(
                            id: "\(recording.id)-\(segment.id)",
                            segmentId: segment.id,
                            text: segment.text,
                            highlightedText: highlighted,
                            startTime: segment.startTime,
                            speaker: segment.speaker
                        ))
                    }
                }
            }

            // Include if title matches or has matching segments
            if titleMatches || !matchingSegments.isEmpty {
                searchResults.append(SearchResult(
                    id: recording.id,
                    recording: recording,
                    matchingSegments: matchingSegments,
                    matchCount: matchingSegments.count + (titleMatches ? 1 : 0)
                ))
            }
        }

        // Sort by match count (descending), then by date (newest first)
        return searchResults.sorted { lhs, rhs in
            if lhs.matchCount != rhs.matchCount {
                return lhs.matchCount > rhs.matchCount
            }
            return lhs.recording.createdAt > rhs.recording.createdAt
        }
    }

    /// Highlight matching keywords in text
    private func highlightMatches(in text: String, keywords: [String]) -> AttributedString {
        var attributed = AttributedString(text)

        for keyword in keywords {
            var searchRange = attributed.startIndex..<attributed.endIndex

            while let range = attributed[searchRange].range(of: keyword, options: .caseInsensitive) {
                attributed[range].foregroundColor = .orange
                attributed[range].font = .body.bold()

                // Move search range forward
                if range.upperBound < attributed.endIndex {
                    searchRange = range.upperBound..<attributed.endIndex
                } else {
                    break
                }
            }
        }

        return attributed
    }

    // MARK: - Recent Searches

    private func loadRecentSearches() {
        recentSearches = UserDefaults.standard.stringArray(forKey: "recentSearches") ?? []
    }

    private func saveRecentSearch(_ query: String) {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Remove if already exists
        recentSearches.removeAll { $0.lowercased() == trimmed.lowercased() }

        // Add to front
        recentSearches.insert(trimmed, at: 0)

        // Limit count
        if recentSearches.count > maxRecentSearches {
            recentSearches = Array(recentSearches.prefix(maxRecentSearches))
        }

        UserDefaults.standard.set(recentSearches, forKey: "recentSearches")
    }

    // MARK: - Helpers

    /// Format timestamp for display
    func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }
}
