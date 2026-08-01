import Foundation

/// Mirror of the backend's `/api/coaching/*` response shapes. See
/// REALTIME_COACHING.md for the design.

enum CoachingPersonaKey: String, Codable, CaseIterable {
    case salesDiscovery = "sales_discovery"

    var displayName: String {
        switch self {
        case .salesDiscovery: return "Sales Discovery"
        }
    }
}

struct CoachingCredits: Codable {
    let balance: Int
    let bySource: [String: Int]

    enum CodingKeys: String, CodingKey {
        case balance
        case bySource = "by_source"
    }

    var hasCredits: Bool { balance > 0 }
}

struct CoachingClaimFreeResponse: Codable {
    let granted: Bool
    let balance: Int
    let freeTierCredits: Int

    enum CodingKeys: String, CodingKey {
        case granted, balance
        case freeTierCredits = "free_tier_credits"
    }
}

struct CoachingSessionStart: Codable {
    let sessionId: String
    let persona: String

    enum CodingKeys: String, CodingKey {
        case sessionId = "session_id"
        case persona
    }
}

struct CoachingInsight: Codable, Identifiable, Equatable {
    let id: String
    let sessionId: String
    let type: InsightType
    let text: String
    let urgency: Urgency
    let transcriptOffsetSeconds: Int?
    let emittedAt: Date

    enum InsightType: String, Codable {
        case question, objection, signal, gap
    }
    enum Urgency: String, Codable {
        case now, soon
        case beforeEnd = "before-end"

        var sortKey: Int {
            switch self { case .now: return 0; case .soon: return 1; case .beforeEnd: return 2 }
        }
    }

    enum CodingKeys: String, CodingKey {
        case id
        case sessionId = "session_id"
        case type, text, urgency
        case transcriptOffsetSeconds = "transcript_offset_seconds"
        case emittedAt = "emitted_at"
    }
}

struct CoachingEndResponse: Codable {
    let ended: Bool
    let refunded: Bool
}
