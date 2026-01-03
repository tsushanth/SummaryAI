import Foundation

// MARK: - Join Meeting Response

struct JoinMeetingResponse: Codable {
    let meeting: JoinedMeeting
    let botId: String

    enum CodingKeys: String, CodingKey {
        case meeting
        case botId = "bot_id"
    }
}

struct JoinedMeeting: Codable {
    let id: String
    let title: String
    let platform: String?
    let status: String
    let joinUrl: String

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case platform
        case status
        case joinUrl = "join_url"
    }
}

// MARK: - Join Meeting View Model

@MainActor
final class JoinMeetingViewModel: ObservableObject {

    // MARK: - Published Properties

    @Published var meetingUrl: String = ""
    @Published var botName: String = ""
    @Published var isJoining = false
    @Published var errorMessage: String?
    @Published var showError = false
    @Published var joinedMeeting: JoinedMeeting?
    @Published var showSuccess = false

    // MARK: - Computed Properties

    var isValidUrl: Bool {
        guard !meetingUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }

        let url = meetingUrl.lowercased()
        return url.contains("zoom.us") ||
               url.contains("zoom.com") ||
               url.contains("meet.google.com") ||
               url.contains("teams.microsoft.com") ||
               url.contains("teams.live.com") ||
               url.contains("webex.com") ||
               url.contains("gotomeet.me") ||
               url.contains("gotomeeting.com") ||
               url.contains("chime.aws") ||
               url.contains("bluejeans.com")
    }

    var detectedPlatform: String? {
        let url = meetingUrl.lowercased()

        if url.contains("zoom.us") || url.contains("zoom.com") {
            return "Zoom"
        } else if url.contains("meet.google.com") {
            return "Google Meet"
        } else if url.contains("teams.microsoft.com") || url.contains("teams.live.com") {
            return "Microsoft Teams"
        } else if url.contains("webex.com") {
            return "Webex"
        } else if url.contains("gotomeet.me") || url.contains("gotomeeting.com") {
            return "GoTo Meeting"
        } else if url.contains("chime.aws") {
            return "Amazon Chime"
        } else if url.contains("bluejeans.com") {
            return "BlueJeans"
        }

        return nil
    }

    var canJoin: Bool {
        isValidUrl && !isJoining
    }

    var effectiveBotName: String {
        botName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Meeting Mind" : botName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Properties

    private var apiClient: SummaryAIAPIClient

    // MARK: - Initialization

    init(apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
    }

    func updateApiClient(_ newClient: SummaryAIAPIClient) {
        self.apiClient = newClient
    }

    // MARK: - Join Meeting

    func joinMeeting() async {
        guard canJoin else { return }

        isJoining = true
        errorMessage = nil

        defer { isJoining = false }

        do {
            let body = JoinMeetingRequest(
                joinUrl: meetingUrl.trimmingCharacters(in: .whitespacesAndNewlines),
                botName: botName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : botName.trimmingCharacters(in: .whitespacesAndNewlines),
                title: nil
            )

            let response: JoinMeetingResponse = try await apiClient.post(
                endpoint: "/api/meetings/join",
                body: body,
                responseType: JoinMeetingResponse.self
            )

            print("[JoinMeetingVM] Bot joining meeting: \(response.meeting.id), bot_id: \(response.botId)")

            joinedMeeting = response.meeting
            showSuccess = true

            // Reset form after successful join
            meetingUrl = ""
            botName = ""

        } catch {
            print("[JoinMeetingVM] Failed to join meeting: \(error)")

            if let apiError = error as? APIError {
                switch apiError {
                case .httpError(let statusCode, let message):
                    if statusCode == 400 {
                        errorMessage = message ?? "Invalid meeting URL. Please check and try again."
                    } else {
                        errorMessage = message ?? "Failed to join meeting. Please try again."
                    }
                default:
                    errorMessage = "Failed to join meeting. Please try again."
                }
            } else {
                errorMessage = "Network error. Please check your connection."
            }

            showError = true
        }
    }

    // MARK: - Reset

    func reset() {
        meetingUrl = ""
        botName = ""
        joinedMeeting = nil
        showSuccess = false
        errorMessage = nil
        showError = false
    }
}

// MARK: - Join Meeting Request

private struct JoinMeetingRequest: Encodable {
    let joinUrl: String
    let botName: String?
    let title: String?

    enum CodingKeys: String, CodingKey {
        case joinUrl = "join_url"
        case botName = "bot_name"
        case title
    }
}
