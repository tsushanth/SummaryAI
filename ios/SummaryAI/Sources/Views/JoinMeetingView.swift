import SwiftUI

// MARK: - Join Meeting View

/// View for manually joining a meeting by entering a URL
struct JoinMeetingView: View {
    @ObservedObject var viewModel: JoinMeetingViewModel
    @FocusState private var isUrlFieldFocused: Bool
    @Environment(\.dismiss) private var dismiss

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

                // Join Button
                joinButton

                // Supported Platforms
                supportedPlatformsSection

                Spacer(minLength: 100)
            }
            .padding(.top, 24)
        }
        .alert("Join Meeting", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) {
                viewModel.showError = false
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
        .alert("Bot Joining", isPresented: $viewModel.showSuccess) {
            Button("OK", role: .cancel) {
                viewModel.showSuccess = false
            }
        } message: {
            if let meeting = viewModel.joinedMeeting {
                Text("The bot is joining your \(meeting.platform ?? "meeting"). You'll see the recording in your Recordings tab once complete.")
            } else {
                Text("The bot is joining your meeting. You'll see the recording in your Recordings tab once complete.")
            }
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if !viewModel.meetingUrl.isEmpty || !viewModel.botName.isEmpty {
                    Button {
                        viewModel.reset()
                        isUrlFieldFocused = false
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
                        isUrlFieldFocused = false
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
                    .focused($isUrlFieldFocused)

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
