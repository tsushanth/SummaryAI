import Foundation

/// Client for the realtime coaching API. Lightweight + self-contained
/// (uses URLSession directly instead of going through SummaryAIAPIClient)
/// because the SSE stream needs `URLSession.bytes(for:)` and that flow
/// doesn't fit the generic Decodable response shape.
@MainActor
final class CoachingClient {
    static let shared = CoachingClient()
    private init() {}

    private let baseURL = URL(string: "https://summary-ai-backend.fly.dev/api/coaching")!
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    // MARK: - Token

    /// The app's existing access-token provider — wired in by SummaryAIApp at launch.
    var accessTokenProvider: (() async -> String?)?

    private func authedRequest(_ path: String, method: String, body: Data? = nil) async throws -> URLRequest {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        guard let token = await accessTokenProvider?() else { throw CoachingError.notSignedIn }
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return req
    }

    // MARK: - REST endpoints

    func claimFreeCredits() async throws -> CoachingClaimFreeResponse {
        let req = try await authedRequest("credits/claim-free", method: "POST")
        return try await sendDecoding(req)
    }

    #if DEBUG
    /// DEBUG ONLY: grants 5 coaching credits per call so we can test the
    /// flow before the real IAPs clear App Store review. Wired to the
    /// "Get credits" button in DEBUG builds.
    struct DebugGrantResponse: Codable {
        let granted: Int
        let balance: Int
    }
    func debugGrantCredits() async throws -> DebugGrantResponse {
        let req = try await authedRequest("credits/grant-debug", method: "POST")
        return try await sendDecoding(req)
    }
    #endif

    func getCredits() async throws -> CoachingCredits {
        let req = try await authedRequest("credits", method: "GET")
        return try await sendDecoding(req)
    }

    func startSession(recordingId: String, persona: CoachingPersonaKey) async throws -> CoachingSessionStart {
        let body = try JSONEncoder().encode(["recording_id": recordingId, "persona": persona.rawValue])
        let req = try await authedRequest("sessions", method: "POST", body: body)
        return try await sendDecoding(req)
    }

    func endSession(sessionId: String) async throws -> CoachingEndResponse {
        let req = try await authedRequest("sessions/\(sessionId)/end", method: "POST")
        return try await sendDecoding(req)
    }

    func getInsights(sessionId: String) async throws -> [CoachingInsight] {
        let req = try await authedRequest("sessions/\(sessionId)/insights", method: "GET")
        struct Wrapper: Decodable { let insights: [CoachingInsight] }
        let wrapper: Wrapper = try await sendDecoding(req)
        return wrapper.insights
    }

    // MARK: - SSE stream

    /// Async stream of insights emitted during the session. Terminates when
    /// the consumer cancels the surrounding task or the server closes.
    func streamInsights(sessionId: String) -> AsyncStream<CoachingInsight> {
        AsyncStream { continuation in
            let task = Task {
                do {
                    let req = try await authedRequest("sessions/\(sessionId)/stream", method: "GET")
                    let (bytes, response) = try await URLSession.shared.bytes(for: req)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        continuation.finish()
                        return
                    }
                    var currentEvent: String? = nil
                    var currentData: String = ""
                    for try await line in bytes.lines {
                        if line.isEmpty {
                            // dispatch the just-completed event
                            if currentEvent == "insight", let payload = currentData.data(using: .utf8) {
                                if let insight = try? decoder.decode(CoachingInsight.self, from: payload) {
                                    continuation.yield(insight)
                                }
                            }
                            currentEvent = nil
                            currentData = ""
                            continue
                        }
                        if line.hasPrefix(": ") { continue }       // heartbeat comment
                        if line.hasPrefix("event:") {
                            currentEvent = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                        } else if line.hasPrefix("data:") {
                            let chunk = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                            currentData = currentData.isEmpty ? chunk : currentData + "\n" + chunk
                        }
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    print("[CoachingClient] SSE error: \(error)")
                    continuation.finish()
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - Plumbing

    private func sendDecoding<T: Decodable>(_ req: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw CoachingError.transport }
        if http.statusCode == 402 { throw CoachingError.noCredits }
        if http.statusCode == 401 { throw CoachingError.notSignedIn }
        guard (200..<300).contains(http.statusCode) else {
            throw CoachingError.http(code: http.statusCode, body: String(data: data, encoding: .utf8) ?? "")
        }
        return try decoder.decode(T.self, from: data)
    }
}

enum CoachingError: Error, LocalizedError {
    case notSignedIn
    case noCredits
    case transport
    case http(code: Int, body: String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Sign in to use AI Coach."
        case .noCredits:   return "No coaching credits. Get more to enable AI Coach."
        case .transport:   return "Network error."
        case .http(let code, _): return "Server returned \(code)."
        }
    }
}
