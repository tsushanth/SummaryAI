import Foundation
import Combine

/// App-wide store for the currently-running coaching session. Lets the
/// JoinMeetingView start a session (when the bot joins the meeting) and the
/// LiveTranscriptView render the live panel without passing sessionId
/// through navigation. End-on-disappear is the consumer's responsibility.
@MainActor
final class ActiveCoachingSession: ObservableObject {
    static let shared = ActiveCoachingSession()
    private init() {}

    /// Keyed by meetingId so the live view can find the right session.
    @Published private(set) var sessionByMeeting: [String: String] = [:]

    /// Live stream wrapper currently driving the panel (only one active session
    /// per user per spec, so a single instance is safe).
    let liveStream = CoachingLiveStream()

    private(set) var activeMeetingId: String?

    func start(meetingId: String, sessionId: String) {
        sessionByMeeting[meetingId] = sessionId
        activeMeetingId = meetingId
        liveStream.start(sessionId: sessionId)
    }

    func sessionId(for meetingId: String) -> String? {
        sessionByMeeting[meetingId]
    }

    func endActive() async {
        await liveStream.stop()
        if let mid = activeMeetingId { sessionByMeeting.removeValue(forKey: mid) }
        activeMeetingId = nil
    }
}
