import Foundation
import Combine

// MARK: - Detail View State

/// Represents the loading state of the recording detail view
enum RecordingDetailState: Equatable {
    case loading
    case loaded
    case error(String)

    var isLoading: Bool {
        self == .loading
    }
}

// MARK: - Q&A State

/// Represents the state of a Q&A interaction
enum QAState: Equatable {
    case idle
    case asking
    case answered
    case error(String)
}

// MARK: - Recording Detail View Model

/// View model for the recording detail screen
@MainActor
final class RecordingDetailViewModel: ObservableObject {

    // MARK: - Published Properties

    /// Main recording data
    @Published private(set) var recording: Recording?
    @Published private(set) var transcript: Transcript?
    @Published private(set) var summary: RecordingSummary?

    /// View state
    @Published private(set) var state: RecordingDetailState = .loading
    @Published private(set) var isRefreshing: Bool = false

    /// Q&A state
    @Published var questionText: String = ""
    @Published private(set) var qaState: QAState = .idle
    @Published private(set) var qaHistory: [QAItem] = []
    @Published private(set) var currentAnswer: QAItem?

    /// Selected transcript segment (for audio seeking)
    @Published var selectedSegment: TranscriptSegment?

    /// Error handling
    @Published var errorMessage: String?
    @Published var showError: Bool = false

    // MARK: - Properties

    let recordingId: String
    private let apiClient: SummaryAIAPIClient
    private var pollingTask: Task<Void, Never>?

    // MARK: - Computed Properties

    /// Whether the recording is ready for Q&A
    var canAskQuestions: Bool {
        guard let recording = recording else { return false }
        return ["transcribed", "summarizing", "completed"].contains(recording.status.rawValue)
    }

    /// Whether the recording is still processing
    var isProcessing: Bool {
        recording?.status.isProcessing ?? false
    }

    /// Formatted duration string
    var formattedDuration: String? {
        guard let seconds = recording?.durationSeconds else { return nil }
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        } else {
            return String(format: "%d:%02d", minutes, secs)
        }
    }

    // MARK: - Initialization

    init(recordingId: String, apiClient: SummaryAIAPIClient = SummaryAIAPIClient()) {
        self.recordingId = recordingId
        self.apiClient = apiClient
    }

    deinit {
        pollingTask?.cancel()
    }

    // MARK: - Data Loading

    /// Load recording details
    func loadRecording() async {
        state = .loading

        do {
            // Fetch recording with transcript and summary
            let response = try await apiClient.getRecording(
                id: recordingId,
                includeTranscript: true,
                includeSummary: true
            )

            recording = response.recording
            transcript = response.transcript
            summary = response.summary

            state = .loaded

            // Start polling if still processing
            if isProcessing {
                startStatusPolling()
            }

            // Load Q&A history
            await loadQAHistory()

        } catch {
            handleError(error)
        }
    }

    /// Refresh recording details
    func refreshRecording() async {
        guard !isRefreshing else { return }
        isRefreshing = true

        do {
            let response = try await apiClient.getRecording(
                id: recordingId,
                includeTranscript: true,
                includeSummary: true
            )

            recording = response.recording
            transcript = response.transcript
            summary = response.summary

            state = .loaded

        } catch {
            // Don't change state on refresh error
            showError(error.localizedDescription)
        }

        isRefreshing = false
    }

    // MARK: - Q&A

    /// Ask a question about the recording
    func askQuestion() async {
        let question = questionText.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !question.isEmpty else { return }
        guard canAskQuestions else {
            showError("Recording must be transcribed before asking questions")
            return
        }

        qaState = .asking

        do {
            let response = try await apiClient.askQuestion(
                recordingId: recordingId,
                question: question
            )

            let qaItem = QAItem(
                id: response.id,
                question: response.question,
                answer: response.answer,
                citations: response.citations,
                confidence: response.confidence,
                createdAt: ISO8601DateFormatter().date(from: response.createdAt) ?? Date()
            )

            currentAnswer = qaItem
            qaHistory.insert(qaItem, at: 0)
            questionText = ""
            qaState = .answered

        } catch {
            qaState = .error(error.localizedDescription)
            showError("Failed to get answer: \(error.localizedDescription)")
        }
    }

    /// Load Q&A history for this recording
    private func loadQAHistory() async {
        do {
            let response = try await apiClient.getQuestions(recordingId: recordingId)

            qaHistory = response.questions.map { qa in
                QAItem(
                    id: qa.id,
                    question: qa.question,
                    answer: qa.answer,
                    citations: qa.citations,
                    confidence: qa.confidence,
                    createdAt: ISO8601DateFormatter().date(from: qa.createdAt) ?? Date()
                )
            }

        } catch {
            // Silently fail - Q&A history is optional
            print("[RecordingDetailViewModel] Failed to load Q&A history: \(error)")
        }
    }

    /// Clear the current answer to ask another question
    func clearCurrentAnswer() {
        currentAnswer = nil
        qaState = .idle
    }

    // MARK: - Transcript Navigation

    /// Handle tap on transcript segment
    /// - Parameter segment: The tapped segment
    func selectSegment(_ segment: TranscriptSegment) {
        selectedSegment = segment
        // Note: Actual audio seeking would be implemented in the view
        // that observes this property and controls audio playback
        print("[RecordingDetailViewModel] Selected segment at \(segment.startTime)s")
    }

    /// Format timestamp for display
    func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%d:%02d", mins, secs)
    }

    // MARK: - Status Polling

    /// Start polling for status updates while processing
    private func startStatusPolling() {
        pollingTask?.cancel()

        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds

                guard !Task.isCancelled else { break }

                do {
                    let response = try await apiClient.getRecording(
                        id: recordingId,
                        includeTranscript: true,
                        includeSummary: true
                    )

                    recording = response.recording
                    transcript = response.transcript
                    summary = response.summary

                    // Stop polling when complete
                    if !isProcessing {
                        break
                    }

                } catch {
                    // Continue polling on error
                    print("[RecordingDetailViewModel] Polling error: \(error)")
                }
            }
        }
    }

    /// Stop status polling
    func stopStatusPolling() {
        pollingTask?.cancel()
        pollingTask = nil
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
    }
}

// MARK: - Q&A Item

/// Represents a Q&A interaction
struct QAItem: Identifiable, Equatable {
    let id: String
    let question: String
    let answer: String
    let citations: [Citation]
    let confidence: Double
    let createdAt: Date

    static func == (lhs: QAItem, rhs: QAItem) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - API Client Extension for Q&A

extension SummaryAIAPIClient {

    /// Ask a question about a recording
    func askQuestion(recordingId: String, question: String) async throws -> AskQuestionResponse {
        let request = AskQuestionRequest(question: question, includeContext: true)

        return try await post(
            endpoint: "/api/recordings/\(recordingId)/questions",
            body: request,
            responseType: AskQuestionResponse.self
        )
    }

    /// Get Q&A history for a recording
    func getQuestions(recordingId: String, limit: Int = 20, offset: Int = 0) async throws -> ListQuestionsResponse {
        return try await get(
            endpoint: "/api/recordings/\(recordingId)/questions",
            queryItems: [
                URLQueryItem(name: "limit", value: String(limit)),
                URLQueryItem(name: "offset", value: String(offset))
            ],
            responseType: ListQuestionsResponse.self
        )
    }
}

// MARK: - Q&A API Models

/// Request to ask a question
struct AskQuestionRequest: Encodable {
    let question: String
    let includeContext: Bool

    enum CodingKeys: String, CodingKey {
        case question
        case includeContext = "include_context"
    }
}

/// Response from asking a question
struct AskQuestionResponse: Decodable {
    let id: String
    let recordingId: String
    let question: String
    let answer: String
    let citations: [Citation]
    let confidence: Double
    let processingTimeMs: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case question
        case answer
        case citations
        case confidence
        case processingTimeMs = "processing_time_ms"
        case createdAt = "created_at"
    }
}

/// Citation reference in an answer
struct Citation: Codable, Equatable {
    let segmentIndex: Int
    let text: String
    let startTime: Double
    let endTime: Double

    enum CodingKeys: String, CodingKey {
        case segmentIndex = "segment_index"
        case text
        case startTime = "start_time"
        case endTime = "end_time"
    }
}

/// Response listing Q&A history
struct ListQuestionsResponse: Decodable {
    let questions: [AskQuestionResponse]
    let totalCount: Int

    enum CodingKeys: String, CodingKey {
        case questions
        case totalCount = "total_count"
    }
}
