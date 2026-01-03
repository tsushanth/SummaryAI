import Foundation
import AuthenticationServices

// MARK: - Calendar Connection Model

struct CalendarConnection: Identifiable, Codable {
    let id: String
    let provider: String
    let providerEmail: String?
    let syncEnabled: Bool
    let lastSyncedAt: Date?
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case provider
        case providerEmail = "provider_email"
        case syncEnabled = "sync_enabled"
        case lastSyncedAt = "last_synced_at"
        case createdAt = "created_at"
    }
}

// MARK: - Calendar API Responses

struct CalendarConnectionsResponse: Codable {
    let connections: [CalendarConnection]
}

struct CalendarConnectResponse: Codable {
    let authUrl: String

    enum CodingKeys: String, CodingKey {
        case authUrl = "auth_url"
    }
}

struct CalendarSyncResponse: Codable {
    let synced: Int
    let meetingsCreated: Int
    let meetingsUpdated: Int

    enum CodingKeys: String, CodingKey {
        case synced
        case meetingsCreated = "meetings_created"
        case meetingsUpdated = "meetings_updated"
    }
}

// MARK: - Calendar View Model

@MainActor
final class CalendarViewModel: NSObject, ObservableObject {

    // MARK: - Published Properties

    @Published var connections: [CalendarConnection] = []
    @Published var meetings: [Meeting] = []
    @Published var isLoading = false
    @Published var isConnecting = false
    @Published var isSyncing = false
    @Published var isLoadingMeetings = false
    @Published var errorMessage: String?
    @Published var showError = false

    // MARK: - Computed Properties

    var hasConnectedCalendars: Bool {
        !connections.isEmpty
    }

    var googleConnection: CalendarConnection? {
        connections.first { $0.provider == "google" }
    }

    var outlookConnection: CalendarConnection? {
        connections.first { $0.provider == "microsoft" }
    }

    // MARK: - Properties

    private var apiClient: SummaryAIAPIClient
    private var webAuthSession: ASWebAuthenticationSession?

    // MARK: - Initialization

    init(apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
        super.init()
    }

    /// Update the API client (used when environment object becomes available)
    func updateApiClient(_ newClient: SummaryAIAPIClient) {
        self.apiClient = newClient
    }

    // MARK: - Load Connections

    func loadConnections() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let response: CalendarConnectionsResponse = try await apiClient.get(
                endpoint: "/api/calendar/connections",
                responseType: CalendarConnectionsResponse.self
            )
            connections = response.connections
            print("[CalendarVM] Loaded \(connections.count) calendar connections")
        } catch {
            print("[CalendarVM] Failed to load connections: \(error)")
            // Don't show error for initial load - user might not have any connections
        }
    }

    // MARK: - Connect Google Calendar

    func connectGoogleCalendar() async {
        isConnecting = true
        defer { isConnecting = false }

        do {
            // Get OAuth URL from backend
            let response: CalendarConnectResponse = try await apiClient.post(
                endpoint: "/api/calendar/connect/google",
                body: EmptyBody(),
                responseType: CalendarConnectResponse.self
            )

            print("[CalendarVM] Got OAuth URL: \(response.authUrl)")

            // Open OAuth flow in web authentication session
            await startOAuthFlow(url: response.authUrl, provider: "google")

        } catch {
            print("[CalendarVM] Failed to initiate Google OAuth: \(error)")
            errorMessage = "Failed to connect Google Calendar. Please try again."
            showError = true
        }
    }

    // MARK: - Connect Microsoft Outlook

    func connectOutlook() async {
        isConnecting = true
        defer { isConnecting = false }

        do {
            // Get OAuth URL from backend
            let response: CalendarConnectResponse = try await apiClient.post(
                endpoint: "/api/calendar/connect/microsoft",
                body: EmptyBody(),
                responseType: CalendarConnectResponse.self
            )

            print("[CalendarVM] Got Microsoft OAuth URL: \(response.authUrl)")

            // Open OAuth flow in web authentication session
            await startOAuthFlow(url: response.authUrl, provider: "microsoft")

        } catch {
            print("[CalendarVM] Failed to initiate Microsoft OAuth: \(error)")
            errorMessage = "Failed to connect Microsoft Outlook. Please try again."
            showError = true
        }
    }

    // MARK: - Disconnect Calendar

    func disconnect(provider: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            try await apiClient.delete(endpoint: "/api/calendar/connections/\(provider)")

            // Remove from local list
            connections.removeAll { $0.provider == provider }
            print("[CalendarVM] Disconnected \(provider)")

        } catch {
            print("[CalendarVM] Failed to disconnect \(provider): \(error)")
            errorMessage = "Failed to disconnect. Please try again."
            showError = true
        }
    }

    // MARK: - Sync Calendars

    func syncCalendars() async {
        isSyncing = true
        defer { isSyncing = false }

        do {
            let response: CalendarSyncResponse = try await apiClient.post(
                endpoint: "/api/calendar/sync",
                body: EmptyBody(),
                responseType: CalendarSyncResponse.self
            )

            print("[CalendarVM] Sync complete: \(response.meetingsCreated) created, \(response.meetingsUpdated) updated")

            // Reload connections to update last_synced_at
            await loadConnections()

            // Load meetings after sync
            await loadMeetings()

        } catch {
            print("[CalendarVM] Failed to sync: \(error)")
            errorMessage = "Failed to sync calendars. Please try again."
            showError = true
        }
    }

    // MARK: - Load Meetings

    func loadMeetings() async {
        isLoadingMeetings = true
        defer { isLoadingMeetings = false }

        do {
            let response: MeetingsResponse = try await apiClient.get(
                endpoint: "/api/meetings",
                queryItems: [
                    URLQueryItem(name: "limit", value: "50"),
                    URLQueryItem(name: "status", value: "upcoming")
                ],
                responseType: MeetingsResponse.self
            )
            meetings = response.meetings
            print("[CalendarVM] Loaded \(meetings.count) meetings")
        } catch {
            print("[CalendarVM] Failed to load meetings: \(error)")
            // Don't show error - user might not have any meetings
        }
    }

    // MARK: - Toggle Auto Join

    func toggleAutoJoin(meetingId: String, enabled: Bool) async {
        do {
            let body = AutoJoinRequest(autoJoin: enabled)
            try await apiClient.patch(
                endpoint: "/api/meetings/\(meetingId)",
                body: body
            )

            // Update local state
            if let index = meetings.firstIndex(where: { $0.id == meetingId }) {
                var updatedMeeting = meetings[index]
                // Create a new meeting with updated autoJoin
                meetings[index] = Meeting(
                    id: updatedMeeting.id,
                    title: updatedMeeting.title,
                    platform: updatedMeeting.platform,
                    source: updatedMeeting.source,
                    scheduledStart: updatedMeeting.scheduledStart,
                    scheduledEnd: updatedMeeting.scheduledEnd,
                    autoJoin: enabled,
                    status: updatedMeeting.status,
                    recordingId: updatedMeeting.recordingId
                )
            }

            print("[CalendarVM] Updated auto_join for meeting \(meetingId) to \(enabled)")
        } catch {
            print("[CalendarVM] Failed to toggle auto join: \(error)")
            errorMessage = "Failed to update meeting settings."
            showError = true
        }
    }

    // MARK: - Refresh All

    func refreshAll() async {
        // Load connections first (silently fails if no connections)
        await loadConnections()

        // Only sync if we have connected calendars
        guard hasConnectedCalendars else {
            print("[CalendarVM] No connected calendars, skipping sync")
            return
        }

        // Sync calendars - but don't show error for pull-to-refresh
        // Use syncCalendarsQuietly to avoid error popups on background refresh
        await syncCalendarsQuietly()
    }

    /// Sync calendars without showing error alerts (for pull-to-refresh)
    private func syncCalendarsQuietly() async {
        isSyncing = true
        defer { isSyncing = false }

        do {
            let response: CalendarSyncResponse = try await apiClient.post(
                endpoint: "/api/calendar/sync",
                body: EmptyBody(),
                responseType: CalendarSyncResponse.self
            )

            print("[CalendarVM] Sync complete: \(response.meetingsCreated) created, \(response.meetingsUpdated) updated")

            // Reload connections to update last_synced_at
            await loadConnections()

            // Load meetings after sync
            await loadMeetings()

        } catch {
            print("[CalendarVM] Failed to sync (quiet): \(error)")
            // Don't show error - just load meetings from cache/server
            await loadMeetings()
        }
    }

    // MARK: - OAuth Flow

    private func startOAuthFlow(url: String, provider: String) async {
        guard let authURL = URL(string: url) else {
            errorMessage = "Invalid OAuth URL"
            showError = true
            return
        }

        // The callback scheme for our app
        let callbackScheme = "summaryai"

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            webAuthSession = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackURL, error in
                Task { @MainActor in
                    defer { continuation.resume() }

                    if let error = error {
                        if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                            print("[CalendarVM] User cancelled OAuth flow")
                        } else {
                            print("[CalendarVM] OAuth error: \(error)")
                            self?.errorMessage = "Authentication failed. Please try again."
                            self?.showError = true
                        }
                        return
                    }

                    guard let callbackURL = callbackURL else {
                        print("[CalendarVM] No callback URL received")
                        self?.errorMessage = "Authentication failed. Please try again."
                        self?.showError = true
                        return
                    }

                    // Parse callback URL
                    // Expected format: summaryai://calendar/connected?provider=google&email=user@gmail.com
                    // Or error: summaryai://calendar/error?message=...
                    print("[CalendarVM] OAuth callback: \(callbackURL)")

                    if callbackURL.host == "calendar" {
                        let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)

                        if callbackURL.path == "/connected" || callbackURL.pathComponents.contains("connected") {
                            // Success!
                            let email = components?.queryItems?.first { $0.name == "email" }?.value
                            print("[CalendarVM] Successfully connected \(provider): \(email ?? "unknown")")

                            // Reload connections and sync calendars
                            await self?.loadConnections()
                            await self?.syncCalendars()

                        } else if callbackURL.path == "/error" || callbackURL.pathComponents.contains("error") {
                            let message = components?.queryItems?.first { $0.name == "message" }?.value ?? "Unknown error"
                            print("[CalendarVM] OAuth error: \(message)")
                            self?.errorMessage = "Failed to connect calendar: \(message)"
                            self?.showError = true
                        }
                    }
                }
            }

            webAuthSession?.presentationContextProvider = self
            webAuthSession?.prefersEphemeralWebBrowserSession = false
            webAuthSession?.start()
        }
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

extension CalendarViewModel: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Get the key window
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            return ASPresentationAnchor()
        }
        return window
    }
}

// MARK: - Empty Body for POST requests

private struct EmptyBody: Encodable {}

// MARK: - Auto Join Request

private struct AutoJoinRequest: Encodable {
    let autoJoin: Bool

    enum CodingKeys: String, CodingKey {
        case autoJoin = "auto_join"
    }
}
