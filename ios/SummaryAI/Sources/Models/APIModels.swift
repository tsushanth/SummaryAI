import Foundation

// MARK: - Recording Status

/// Processing status for a recording
enum RecordingStatus: String, Codable, CaseIterable {
    case pending
    case uploading
    case uploaded
    case transcribing
    case transcribed
    case summarizing
    case completed
    case failed

    var displayName: String {
        switch self {
        case .pending: return "Pending"
        case .uploading: return "Uploading"
        case .uploaded: return "Processing"
        case .transcribing: return "Transcribing"
        case .transcribed: return "Processing"
        case .summarizing: return "Summarizing"
        case .completed: return "Completed"
        case .failed: return "Failed"
        }
    }

    var isProcessing: Bool {
        switch self {
        case .uploading, .uploaded, .transcribing, .summarizing:
            return true
        case .pending, .transcribed, .completed, .failed:
            return false
        }
    }
}

// MARK: - Recording Model

/// Recording data from the API
struct Recording: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    var title: String
    var durationSeconds: Int?
    var fileSizeBytes: Int64?
    let filePath: String?
    var status: RecordingStatus
    var errorMessage: String?
    var speakerCount: Int?
    var wordCount: Int?
    var language: String?
    var tags: [String]?
    var isFavorite: Bool?
    let createdAt: Date
    var updatedAt: Date?
    var processedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case title
        case durationSeconds = "duration_seconds"
        case fileSizeBytes = "file_size_bytes"
        case filePath = "file_path"
        case status
        case errorMessage = "error_message"
        case speakerCount = "speaker_count"
        case wordCount = "word_count"
        case language
        case tags
        case isFavorite = "is_favorite"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case processedAt = "processed_at"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Recording, rhs: Recording) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - API Request Models

/// Request to create a new recording
struct CreateRecordingRequest: Codable {
    let title: String
    let durationSeconds: Int
    let fileSizeBytes: Int64
    let contentType: String

    enum CodingKeys: String, CodingKey {
        case title
        case durationSeconds = "duration_seconds"
        case fileSizeBytes = "file_size_bytes"
        case contentType = "content_type"
    }
}

/// Request to complete upload
struct CompleteUploadRequest: Codable {
    let fileSizeBytes: Int64?
    let checksum: String?

    enum CodingKeys: String, CodingKey {
        case fileSizeBytes = "file_size_bytes"
        case checksum
    }

    init(fileSizeBytes: Int64? = nil, checksum: String? = nil) {
        self.fileSizeBytes = fileSizeBytes
        self.checksum = checksum
    }
}

// MARK: - API Response Models

/// Upload information returned when creating a recording
struct UploadInfo: Codable {
    let url: String
    let method: String
    let headers: [String: String]
    let expiresAt: Date

    enum CodingKeys: String, CodingKey {
        case url
        case method
        case headers
        case expiresAt = "expires_at"
    }
}

/// Response from creating a recording
struct CreateRecordingResponse: Codable {
    let recording: Recording
    let upload: UploadInfo
}

/// Job info in complete upload response
struct JobInfo: Codable {
    let id: String
    let status: String
    let estimatedDurationSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case status
        case estimatedDurationSeconds = "estimated_duration_seconds"
    }
}

/// Response from completing upload
struct CompleteUploadResponse: Codable {
    let recording: Recording
    let job: JobInfo
}

/// Pagination metadata
struct PaginationMeta: Codable {
    let page: Int
    let perPage: Int
    let totalCount: Int
    let totalPages: Int

    enum CodingKeys: String, CodingKey {
        case page
        case perPage = "per_page"
        case totalCount = "total_count"
        case totalPages = "total_pages"
    }

    /// Whether there are more pages to load
    var hasMore: Bool {
        page < totalPages
    }
}

/// Response from listing recordings
struct ListRecordingsResponse: Codable {
    let recordings: [Recording]
    let meta: PaginationMeta

    /// Convenience accessor for pagination
    var pagination: PaginationMeta {
        meta
    }
}

/// Response from getting a single recording
struct GetRecordingResponse: Codable {
    let recording: Recording
    let transcript: Transcript?
    let summary: Summary?
    let audioUrl: String?
    let audioUrlExpiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case recording
        case transcript
        case summary
        case audioUrl = "audio_url"
        case audioUrlExpiresAt = "audio_url_expires_at"
    }
}

// MARK: - Transcript Models

/// Transcript segment
struct TranscriptSegment: Codable, Identifiable, Equatable {
    let id: String
    let speakerLabel: String?
    let speakerIndex: Int?
    let text: String
    let startTime: Double
    let endTime: Double
    let confidence: Double?

    enum CodingKeys: String, CodingKey {
        case id
        case speakerLabel = "speaker_label"
        case speakerIndex = "speaker_index"
        case text
        case startTime = "start_time"
        case endTime = "end_time"
        case confidence
    }

    /// Convenience property for speaker display
    var speaker: String? {
        speakerLabel
    }

    var duration: Double {
        endTime - startTime
    }

    func contains(time: Double) -> Bool {
        time >= startTime && time < endTime
    }

    static func == (lhs: TranscriptSegment, rhs: TranscriptSegment) -> Bool {
        lhs.id == rhs.id
    }
}

/// Full transcript
struct Transcript: Codable {
    let id: String
    let recordingId: String
    let fullText: String
    let segments: [TranscriptSegment]
    let wordCount: Int
    let speakerCount: Int
    let language: String
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case fullText = "full_text"
        case segments
        case wordCount = "word_count"
        case speakerCount = "speaker_count"
        case language
        case createdAt = "created_at"
    }
}

// MARK: - Summary Models

/// Action item from summary
struct ActionItem: Codable, Identifiable {
    let id: String?
    let task: String
    let assignee: String?
    let dueDate: String?
    let priority: String?

    enum CodingKeys: String, CodingKey {
        case id
        case task
        case assignee
        case dueDate = "due_date"
        case priority
    }

    // Generate stable ID if not provided
    var stableId: String {
        id ?? task
    }
}

/// Sentiment analysis
struct Sentiment: Codable {
    let overall: String
    let score: Double
}

/// Full summary
struct RecordingSummary: Codable {
    let id: String
    let recordingId: String
    let summary: String
    let keyPoints: [String]
    let actionItems: [ActionItem]?
    let topics: [String]?
    let sentiment: Sentiment?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case summary
        case keyPoints = "key_points"
        case actionItems = "action_items"
        case topics
        case sentiment
        case createdAt = "created_at"
    }
}

/// Type alias for backward compatibility
typealias Summary = RecordingSummary

// MARK: - Error Response

/// API error response
struct APIErrorResponse: Codable {
    let error: APIErrorDetail
}

struct APIErrorDetail: Codable {
    let code: String
    let message: String
    let details: [String: String]?
}
