import Foundation
import AdServices

// MARK: - Attribution Service

/// Service for collecting and sending Apple Search Ads attribution data
/// Uses the AdServices framework to fetch attribution tokens and sends them to the backend
/// for ASA bid optimization.
final class AttributionService {

    // MARK: - Singleton

    static let shared = AttributionService()

    // MARK: - Properties

    private let userDefaults = UserDefaults.standard
    private let attributionSentKey = "com.kreativekoala.summaryai.attributionSent"

    // MARK: - Initialization

    private init() {}

    // MARK: - Public Methods

    /// Fetch and send attribution data on app launch
    /// Should be called once when the app starts
    func trackAttribution() {
        // Only send attribution once per install
        guard !hasAttributionBeenSent else {
            print("[AttributionService] Attribution already sent for this install")
            return
        }

        Task {
            await fetchAndSendAttribution()
        }
    }

    // MARK: - Private Methods

    private var hasAttributionBeenSent: Bool {
        userDefaults.bool(forKey: attributionSentKey)
    }

    private func markAttributionAsSent() {
        userDefaults.set(true, forKey: attributionSentKey)
    }

    @MainActor
    private func fetchAndSendAttribution() async {
        do {
            // Fetch the attribution token from AdServices
            // This is available on iOS 14.3+
            let token = try AAAttribution.attributionToken()
            print("[AttributionService] Got attribution token: \(token.prefix(50))...")

            // Send to backend for ASA bid optimization
            try await sendAttributionToBackend(token: token)

            // Mark as sent so we don't send again
            markAttributionAsSent()
            print("[AttributionService] Attribution data sent successfully")

        } catch {
            // Attribution can fail for various reasons:
            // - User has limited ad tracking
            // - Not installed via App Store (TestFlight, direct install)
            // - Network issues
            print("[AttributionService] Failed to get/send attribution: \(error.localizedDescription)")
        }
    }

    private func sendAttributionToBackend(token: String) async throws {
        // Build the API request
        guard let url = URL(string: "https://summary-ai-backend-917362189743.us-central1.run.app/v1/api/attribution/apple-search-ads") else {
            throw AttributionError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Build the payload
        let payload = AttributionPayload(
            token: token,
            bundleId: Bundle.main.bundleIdentifier ?? "com.kreativekoala.summaryai",
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            platform: "ios"
        )

        request.httpBody = try JSONEncoder().encode(payload)

        // Send the request
        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AttributionError.invalidResponse
        }

        // Accept 2xx responses as success
        // Also accept 409 (conflict) which means attribution was already recorded
        guard (200...299).contains(httpResponse.statusCode) || httpResponse.statusCode == 409 else {
            throw AttributionError.serverError(statusCode: httpResponse.statusCode)
        }
    }
}

// MARK: - Supporting Types

private struct AttributionPayload: Encodable {
    let token: String
    let bundleId: String
    let appVersion: String
    let platform: String
}

private enum AttributionError: Error {
    case invalidURL
    case invalidResponse
    case serverError(statusCode: Int)

    var localizedDescription: String {
        switch self {
        case .invalidURL:
            return "Invalid attribution API URL"
        case .invalidResponse:
            return "Invalid server response"
        case .serverError(let statusCode):
            return "Server error: \(statusCode)"
        }
    }
}
