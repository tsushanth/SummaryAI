import SwiftUI

// MARK: - Join Meeting View

/// Focus state for text fields
private enum FocusedField {
    case url
    case botName
}

/// View for manually joining a meeting by entering a URL
struct JoinMeetingView: View {
    @ObservedObject var viewModel: JoinMeetingViewModel
    @FocusState private var focusedField: FocusedField?
    @Environment(\.dismiss) private var dismiss

    // MARK: - Coaching state

    @State private var coachingEnabled = false
    @State private var coachingPersona: CoachingPersonaKey = .salesDiscovery
    @State private var coachingCredits = 0
    @State private var loadingCredits = false
    @State private var coachingError: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Header
                headerSection

                // URL Input
                urlInputSection

                // Bot Name Input (Optional)
                botNameSection

                // Platform Detection Badge
                if let platform = viewModel.detectedPlatform {
                    platformBadge(platform: platform)
                }

                // AI Coach toggle
                CoachingToggleCard(
                    isEnabled: $coachingEnabled,
                    persona: $coachingPersona,
                    creditBalance: coachingCredits,
                    isLoadingBalance: loadingCredits,
                    onGetMoreCredits: { Task { await debugGrantCredits() } },
                    onClaimFreeTier: { await claimFreeCoachingTier() }
                )
                .padding(.horizontal)

                // Join Button
                joinButton

                // Supported Platforms
                supportedPlatformsSection

                Spacer(minLength: 100)
            }
            .padding(.top, 24)
        }
        .onChange(of: viewModel.showSuccess) { _, isShowing in
            // When join succeeds (alert appears), start coaching if requested.
            if isShowing,
               let meeting = viewModel.joinedMeeting,
               let recordingId = viewModel.joinedRecordingId ?? viewModel.joinedMeeting?.recordingId {
                Task { await startCoachingIfRequested(meetingId: meeting.id, recordingId: recordingId) }
            }
        }
        .alert("AI Coach", isPresented: Binding(
            get: { coachingError != nil },
            set: { if !$0 { coachingError = nil } }
        )) {
            Button("OK", role: .cancel) { coachingError = nil }
        } message: { Text(coachingError ?? "") }
        .alert("Join Meeting", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) {
                viewModel.showError = false
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
        .alert("Bot Joining", isPresented: $viewModel.showSuccess) {
            if viewModel.joinedRecordingId != nil {
                Button("View Recording") {
                    viewModel.showSuccess = false
                    viewModel.navigateToRecording = true
                }
                Button("OK", role: .cancel) {
                    viewModel.showSuccess = false
                }
            } else {
                Button("OK", role: .cancel) {
                    viewModel.showSuccess = false
                }
            }
        } message: {
            if let meeting = viewModel.joinedMeeting {
                Text("The bot is joining your \(meeting.platform ?? "meeting"). You can track the recording progress in real-time.")
            } else {
                Text("The bot is joining your meeting. You can track the recording progress in real-time.")
            }
        }
        .navigationDestination(isPresented: $viewModel.navigateToRecording) {
            if let recordingId = viewModel.joinedRecordingId {
                RecordingDetailView(recordingId: recordingId)
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if !viewModel.meetingUrl.isEmpty || !viewModel.botName.isEmpty {
                    Button {
                        viewModel.reset()
                        focusedField = nil
                    } label: {
                        Text("Clear")
                            .foregroundColor(.blue)
                    }
                }
            }
            ToolbarItem(placement: .keyboard) {
                HStack {
                    Spacer()
                    Button("Done") {
                        focusedField = nil
                    }
                }
            }
        }
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 80, height: 80)
                    .shadow(color: .blue.opacity(0.3), radius: 10, y: 5)

                Image(systemName: "video.badge.plus")
                    .font(.system(size: 36))
                    .foregroundColor(.white)
            }

            Text("Join a Meeting")
                .font(.title2)
                .fontWeight(.bold)

            Text("Paste your meeting link and our bot will join to record and transcribe")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .padding(.horizontal)
    }

    // MARK: - URL Input Section

    private var urlInputSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Meeting URL")
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundColor(.secondary)

            HStack(spacing: 12) {
                Image(systemName: "link")
                    .foregroundColor(.secondary)
                    .frame(width: 20)

                TextField("https://zoom.us/j/123456789", text: $viewModel.meetingUrl)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .url)

                if !viewModel.meetingUrl.isEmpty {
                    Button {
                        viewModel.meetingUrl = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)

            if !viewModel.meetingUrl.isEmpty && !viewModel.isValidUrl {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption)
                    Text("Please enter a valid meeting URL")
                        .font(.caption)
                }
                .foregroundColor(.orange)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Bot Name Section

    private var botNameSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Bot Name")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.secondary)

                Text("(Optional)")
                    .font(.caption)
                    .foregroundColor(.secondary.opacity(0.7))
            }

            HStack(spacing: 12) {
                Image(systemName: "person.crop.circle")
                    .foregroundColor(.secondary)
                    .frame(width: 20)

                TextField("Meeting Mind", text: $viewModel.botName)
                    .autocapitalization(.words)
                    .focused($focusedField, equals: .botName)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)

            Text("This name will appear in the meeting participant list")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.horizontal)
    }

    // MARK: - Platform Badge

    private func platformBadge(platform: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundColor(.green)

            Text("\(platform) detected")
                .font(.subheadline)
                .foregroundColor(.primary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.green.opacity(0.1))
        .cornerRadius(20)
    }

    // MARK: - Join Button

    private var joinButton: some View {
        Button {
            Task {
                await viewModel.joinMeeting()
            }
        } label: {
            HStack(spacing: 8) {
                if viewModel.isJoining {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .scaleEffect(0.9)
                } else {
                    Image(systemName: "video.fill")
                }

                Text(viewModel.isJoining ? "Joining..." : "Join Meeting")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                viewModel.canJoin
                    ? LinearGradient(
                        colors: [.blue, .blue.opacity(0.8)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    : LinearGradient(
                        colors: [.gray.opacity(0.5), .gray.opacity(0.5)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
            )
            .foregroundColor(.white)
            .cornerRadius(16)
        }
        .disabled(!viewModel.canJoin)
        .padding(.horizontal)
    }

    // MARK: - Supported Platforms Section

    private var supportedPlatformsSection: some View {
        VStack(spacing: 12) {
            Text("Supported Platforms")
                .font(.caption)
                .foregroundColor(.secondary)
                .fontWeight(.medium)

            HStack(spacing: 16) {
                platformIcon(name: "Zoom", icon: "video.fill", color: .blue)
                platformIcon(name: "Teams", icon: "person.3.fill", color: Color(red: 0.29, green: 0.29, blue: 0.73))
                platformIcon(name: "Meet", icon: "video.fill", color: .green)
                platformIcon(name: "Webex", icon: "video.fill", color: .cyan)
            }
        }
        .padding(.top, 8)
    }

    private func platformIcon(name: String, icon: String, color: Color) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.15))
                    .frame(width: 44, height: 44)

                Image(systemName: icon)
                    .font(.system(size: 18))
                    .foregroundColor(color)
            }

            Text(name)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
    }

    // MARK: - Coaching helpers

    private func claimFreeCoachingTier() async {
        loadingCredits = true
        defer { loadingCredits = false }
        do {
            _ = try? await CoachingClient.shared.claimFreeCredits()
            let credits = try await CoachingClient.shared.getCredits()
            coachingCredits = credits.balance
        } catch {
            // Silent — user hasn't asked for coaching yet, no need to bug them.
            print("[Coaching] claim/getCredits failed: \(error)")
        }
    }

    private func debugGrantCredits() async {
        #if DEBUG
        loadingCredits = true
        defer { loadingCredits = false }
        do {
            let resp = try await CoachingClient.shared.debugGrantCredits()
            coachingCredits = resp.balance
        } catch {
            coachingError = "Debug grant failed: \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)"
        }
        #else
        coachingError = "Credit purchases are coming soon — check back next release."
        #endif
    }

    /// Called when a meeting was successfully joined and coaching was requested.
    /// Starts a server-side coaching session bound to the recording the bot
    /// will produce, and stashes the session in `ActiveCoachingSession` so the
    /// live meeting view can subscribe to its SSE stream.
    func startCoachingIfRequested(meetingId: String, recordingId: String) async {
        guard coachingEnabled else { return }
        do {
            let session = try await CoachingClient.shared.startSession(
                recordingId: recordingId,
                persona: coachingPersona
            )
            ActiveCoachingSession.shared.start(meetingId: meetingId, sessionId: session.sessionId)
            print("[Coaching] Started session \(session.sessionId) for meeting \(meetingId)")
        } catch {
            coachingError = (error as? LocalizedError)?.errorDescription ?? "Could not start AI Coach."
            print("[Coaching] startSession failed: \(error)")
        }
    }
}

// MARK: - Preview

#if DEBUG
struct JoinMeetingView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            JoinMeetingView(viewModel: JoinMeetingViewModel(apiClient: SummaryAIAPIClient()))
                .navigationTitle("Join")
        }
    }
}
#endif
