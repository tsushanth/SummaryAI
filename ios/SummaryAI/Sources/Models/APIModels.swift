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
        case .pending, .uploading, .uploaded, .transcribing, .transcribed, .summarizing:
            return true
        case .completed, .failed:
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
    var folderId: String?
    var recordingType: RecordingType?
    var meetingId: String?
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
        case folderId = "folder_id"
        case recordingType = "recording_type"
        case meetingId = "meeting_id"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case processedAt = "processed_at"
    }

    /// Whether this recording is for a live meeting in progress
    var isLiveMeeting: Bool {
        meetingId != nil && (status == .pending || status == .uploading)
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Recording, rhs: Recording) -> Bool {
        lhs.id == rhs.id
    }
}

/// Recording type for categorization
enum RecordingType: String, Codable, CaseIterable {
    case general
    case meeting
    case lecture
    case interview
    case voiceMemo = "voice_memo"
    case imported

    var displayName: String {
        switch self {
        case .general: return "General"
        case .meeting: return "Meeting"
        case .lecture: return "Lecture"
        case .interview: return "Interview"
        case .voiceMemo: return "Voice Memo"
        case .imported: return "Imported"
        }
    }

    var icon: String {
        switch self {
        case .general: return "waveform"
        case .meeting: return "person.3.fill"
        case .lecture: return "graduationcap.fill"
        case .interview: return "person.2.fill"
        case .voiceMemo: return "mic.fill"
        case .imported: return "square.and.arrow.down.fill"
        }
    }
}

/// Folder model for organizing recordings
struct Folder: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    var name: String
    var color: String?
    var icon: String?
    var recordingCount: Int?
    let createdAt: Date
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case name
        case color
        case icon
        case recordingCount = "recording_count"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: Folder, rhs: Folder) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - API Request Models

/// Request to create a new recording
struct CreateRecordingRequest: Codable {
    let title: String
    let durationSeconds: Int?
    let fileSizeBytes: Int64
    let contentType: String
    let recordingType: String?
    let outputLanguage: String?

    enum CodingKeys: String, CodingKey {
        case title
        case durationSeconds = "duration_seconds"
        case fileSizeBytes = "file_size_bytes"
        case contentType = "content_type"
        case recordingType = "recording_type"
        case outputLanguage = "output_language"
    }

    init(title: String, durationSeconds: Int? = nil, fileSizeBytes: Int64, contentType: String = "audio/mp4", recordingType: String? = nil, outputLanguage: String? = nil) {
        self.title = title
        self.durationSeconds = durationSeconds
        self.fileSizeBytes = fileSizeBytes
        self.contentType = contentType
        self.recordingType = recordingType
        self.outputLanguage = outputLanguage
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
    /// Maps speaker_index (as string) to custom speaker name
    var speakerNames: [String: String]?

    enum CodingKeys: String, CodingKey {
        case id
        case recordingId = "recording_id"
        case fullText = "full_text"
        case segments
        case wordCount = "word_count"
        case speakerCount = "speaker_count"
        case language
        case createdAt = "created_at"
        case speakerNames = "speaker_names"
    }

    /// Get display name for a speaker index
    func speakerName(for index: Int) -> String {
        speakerNames?[String(index)] ?? "Speaker \(index + 1)"
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

// MARK: - Todo Models

/// Priority level for todos
enum TodoPriority: String, Codable, CaseIterable {
    case low
    case medium
    case high

    var displayName: String {
        switch self {
        case .low: return "Low"
        case .medium: return "Medium"
        case .high: return "High"
        }
    }

    var icon: String {
        switch self {
        case .low: return "arrow.down"
        case .medium: return "minus"
        case .high: return "arrow.up"
        }
    }

    var color: String {
        switch self {
        case .low: return "green"
        case .medium: return "orange"
        case .high: return "red"
        }
    }
}

/// Todo item model
struct TodoItem: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    var recordingId: String?
    var title: String
    var description: String?
    var isCompleted: Bool
    var priority: TodoPriority
    var dueDate: Date?
    var completedAt: Date?
    let createdAt: Date
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case recordingId = "recording_id"
        case title
        case description
        case isCompleted = "is_completed"
        case priority
        case dueDate = "due_date"
        case completedAt = "completed_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: TodoItem, rhs: TodoItem) -> Bool {
        lhs.id == rhs.id
    }
}

/// Request to create a todo
struct CreateTodoRequest: Codable {
    let title: String
    let description: String?
    let priority: String?
    let dueDate: Date?
    let recordingId: String?

    enum CodingKeys: String, CodingKey {
        case title
        case description
        case priority
        case dueDate = "due_date"
        case recordingId = "recording_id"
    }

    init(title: String, description: String? = nil, priority: TodoPriority = .medium, dueDate: Date? = nil, recordingId: String? = nil) {
        self.title = title
        self.description = description
        self.priority = priority.rawValue
        self.dueDate = dueDate
        self.recordingId = recordingId
    }
}

/// Request to create todos from transcribed text
struct CreateTodosFromTextRequest: Codable {
    let text: String
    let recordingId: String?

    enum CodingKeys: String, CodingKey {
        case text
        case recordingId = "recording_id"
    }

    init(text: String, recordingId: String? = nil) {
        self.text = text
        self.recordingId = recordingId
    }
}

/// Request to update a todo
struct UpdateTodoRequest: Codable {
    let title: String?
    let description: String?
    let isCompleted: Bool?
    let priority: String?
    let dueDate: Date?

    enum CodingKeys: String, CodingKey {
        case title
        case description
        case isCompleted = "is_completed"
        case priority
        case dueDate = "due_date"
    }
}

/// Response containing a single todo
struct TodoResponse: Codable {
    let todo: TodoItem
}

/// Response containing multiple todos
struct TodosResponse: Codable {
    let todos: [TodoItem]
}

/// Response from listing todos with pagination
struct ListTodosResponse: Codable {
    let todos: [TodoItem]
    let meta: PaginationMeta
}

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

// MARK: - Live Transcript Models

/// A single live transcript segment received during a meeting
struct LiveTranscriptSegment: Codable, Identifiable {
    let id: String
    let meetingId: String
    let segmentText: String
    let speakerId: String?
    let speakerName: String?
    let isHost: Bool
    let startTimestamp: Double
    let endTimestamp: Double
    let isPartial: Bool
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case meetingId = "meeting_id"
        case segmentText = "segment_text"
        case speakerId = "speaker_id"
        case speakerName = "speaker_name"
        case isHost = "is_host"
        case startTimestamp = "start_timestamp"
        case endTimestamp = "end_timestamp"
        case isPartial = "is_partial"
        case createdAt = "created_at"
    }
}

/// Response for live transcript API
struct LiveTranscriptResponse: Codable {
    let segments: [LiveTranscriptSegment]
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case segments
        case hasMore = "has_more"
    }
}

// MARK: - Phone Call Models

/// Status for a phone call
enum PhoneCallStatus: String, Codable, CaseIterable {
    case initiated
    case ringing
    case inProgress = "in_progress"
    case recording
    case completed
    case failed
    case busy
    case noAnswer = "no_answer"
    case cancelled

    var displayName: String {
        switch self {
        case .initiated: return "Initiated"
        case .ringing: return "Ringing"
        case .inProgress: return "In Progress"
        case .recording: return "Recording"
        case .completed: return "Completed"
        case .failed: return "Failed"
        case .busy: return "Busy"
        case .noAnswer: return "No Answer"
        case .cancelled: return "Cancelled"
        }
    }

    var isActive: Bool {
        switch self {
        case .initiated, .ringing, .inProgress, .recording:
            return true
        case .completed, .failed, .busy, .noAnswer, .cancelled:
            return false
        }
    }

    var icon: String {
        switch self {
        case .initiated: return "phone.arrow.up.right"
        case .ringing: return "phone.badge.waveform"
        case .inProgress: return "phone.fill"
        case .recording: return "waveform"
        case .completed: return "phone.down.fill"
        case .failed: return "phone.fill.badge.xmark"
        case .busy: return "phone.badge.minus"
        case .noAnswer: return "phone.arrow.down.left"
        case .cancelled: return "xmark.circle"
        }
    }
}

/// Verified phone number
struct VerifiedPhone: Codable, Identifiable, Hashable {
    let id: String
    let phoneNumber: String
    let verifiedAt: Date?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case phoneNumber = "phone_number"
        case verifiedAt = "verified_at"
        case createdAt = "created_at"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: VerifiedPhone, rhs: VerifiedPhone) -> Bool {
        lhs.id == rhs.id
    }
}

/// Phone call record
struct PhoneCall: Codable, Identifiable, Hashable {
    let id: String
    let userId: String
    let fromNumber: String
    let toNumber: String
    var toName: String?
    var twilioCallSid: String?
    var conferenceSid: String?
    var conferenceName: String?
    var recordingSid: String?
    var status: PhoneCallStatus
    var isRecording: Bool
    var recordingUrl: String?
    var recordingDuration: Int?
    var recordingId: String?
    var startedAt: Date?
    var answeredAt: Date?
    var recordingStartedAt: Date?
    var endedAt: Date?
    let createdAt: Date
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case fromNumber = "from_number"
        case toNumber = "to_number"
        case toName = "to_name"
        case twilioCallSid = "twilio_call_sid"
        case conferenceSid = "conference_sid"
        case conferenceName = "conference_name"
        case recordingSid = "recording_sid"
        case status
        case isRecording = "is_recording"
        case recordingUrl = "recording_url"
        case recordingDuration = "recording_duration"
        case recordingId = "recording_id"
        case startedAt = "started_at"
        case answeredAt = "answered_at"
        case recordingStartedAt = "recording_started_at"
        case endedAt = "ended_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: PhoneCall, rhs: PhoneCall) -> Bool {
        lhs.id == rhs.id
    }

    /// Format phone number for display
    var formattedToNumber: String {
        formatPhoneNumber(toNumber)
    }

    var formattedFromNumber: String {
        formatPhoneNumber(fromNumber)
    }

    private func formatPhoneNumber(_ phone: String) -> String {
        // Simple US formatting
        if phone.hasPrefix("+1") && phone.count == 12 {
            let start = phone.index(phone.startIndex, offsetBy: 2)
            let area = phone[start..<phone.index(start, offsetBy: 3)]
            let prefix = phone[phone.index(start, offsetBy: 3)..<phone.index(start, offsetBy: 6)]
            let line = phone[phone.index(start, offsetBy: 6)...]
            return "(\(area)) \(prefix)-\(line)"
        }
        return phone
    }

    /// Duration formatted as mm:ss
    var formattedDuration: String {
        guard let duration = recordingDuration else { return "--:--" }
        let mins = duration / 60
        let secs = duration % 60
        return String(format: "%d:%02d", mins, secs)
    }
}

// MARK: - Phone API Request Models

/// Request to send verification code
struct SendVerificationRequest: Codable {
    let phoneNumber: String

    enum CodingKeys: String, CodingKey {
        case phoneNumber = "phone_number"
    }
}

/// Request to check verification code
struct CheckVerificationRequest: Codable {
    let phoneNumber: String
    let code: String

    enum CodingKeys: String, CodingKey {
        case phoneNumber = "phone_number"
        case code
    }
}

/// Request to initiate a phone call
struct InitiateCallRequest: Codable {
    let from: String
    let to: String
    let toName: String?
    let serverInitiated: Bool

    enum CodingKeys: String, CodingKey {
        case from
        case to
        case toName = "to_name"
        case serverInitiated = "server_initiated"
    }

    /// Initialize a call request
    /// - Parameters:
    ///   - from: User's verified phone number
    ///   - to: Destination phone number
    ///   - toName: Optional contact name
    ///   - serverInitiated: If true, server places the call (legacy). Default is false for VoIP calls.
    init(from: String, to: String, toName: String? = nil, serverInitiated: Bool = false) {
        self.from = from
        self.to = to
        self.toName = toName
        self.serverInitiated = serverInitiated
    }
}

// MARK: - Phone API Response Models

/// Response for verification code sent
struct SendVerificationResponse: Codable {
    let message: String
}

/// Response for verification check
struct CheckVerificationResponse: Codable {
    let verified: Bool
    let phone: VerifiedPhone?
}

/// Response containing list of verified phones
struct VerifiedPhonesResponse: Codable {
    let phones: [VerifiedPhone]
}

/// Response for initiating a call
struct InitiateCallResponse: Codable {
    let callId: String
    let status: String
    let twilioCallSid: String?

    enum CodingKeys: String, CodingKey {
        case callId = "call_id"
        case status
        case twilioCallSid = "twilio_call_sid"
    }
}

/// Response for listing phone calls
struct ListPhoneCallsResponse: Codable {
    let calls: [PhoneCall]
    let total: Int
    let limit: Int
    let offset: Int
}

/// Response for single phone call
struct PhoneCallResponse: Codable {
    let call: PhoneCall
}

/// Response for recording control
struct RecordingControlResponse: Codable {
    let recording: Bool
    let conferenceName: String?

    enum CodingKeys: String, CodingKey {
        case recording
        case conferenceName = "conference_name"
    }
}

/// Response for hangup
struct HangupResponse: Codable {
    let ended: Bool
}

/// Response for delete
struct DeletePhoneResponse: Codable {
    let deleted: Bool
}

/// Response for VoIP access token
struct VoipTokenResponse: Codable {
    let token: String
}
