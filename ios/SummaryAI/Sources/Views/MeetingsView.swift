import SwiftUI

// MARK: - Meetings View

/// Main view for the Meetings tab showing calendar connections and upcoming meetings
struct MeetingsView: View {
    @ObservedObject var viewModel: CalendarViewModel
    @EnvironmentObject var apiClient: SummaryAIAPIClient
    @State private var showJoinMeeting = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Quick action: Join meeting by URL
                joinMeetingButton

                // Connected calendars info banner - show when calendars are connected
                if viewModel.hasConnectedCalendars {
                    connectedCalendarsInfoBanner
                }

                // Header section - only show if no calendars connected
                if !viewModel.hasConnectedCalendars {
                    headerSection

                    // Calendar connections section - only show if not connected
                    calendarConnectionsSection

                    Button {
                        // Show more information
                    } label: {
                        Text("Learn more")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                }

                // Upcoming meetings section - only show if calendars are connected
                if viewModel.hasConnectedCalendars {
                    upcomingMeetingsSection
                }

                Spacer(minLength: 100)
            }
            .padding(.top, 24)
        }
        .sheet(isPresented: $showJoinMeeting) {
            NavigationView {
                JoinMeetingView(viewModel: JoinMeetingViewModel(apiClient: apiClient))
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { showJoinMeeting = false }
                        }
                    }
            }
        }
        .refreshable {
            await viewModel.refreshAll()
        }
        .alert("Calendar", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) {
                viewModel.showError = false
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
    }

    // MARK: - Join Meeting Button

    private var joinMeetingButton: some View {
        Button(action: { showJoinMeeting = true }) {
            HStack(spacing: 12) {
                Image(systemName: "video.badge.plus")
                    .font(.system(size: 22))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.blue)
                    .clipShape(Circle())

                VStack(alignment: .leading, spacing: 2) {
                    Text("Join a Meeting")
                        .font(.headline)
                        .foregroundColor(.primary)
                    Text("Paste a Zoom, Meet, or Teams link")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
            .padding(.horizontal)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Connected Calendars Info Banner

    private var connectedCalendarsInfoBanner: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                // Calendar icon
                ZStack {
                    Circle()
                        .fill(Color.blue.opacity(0.1))
                        .frame(width: 40, height: 40)

                    Image(systemName: "calendar.badge.checkmark")
                        .font(.system(size: 18))
                        .foregroundColor(.blue)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text("Calendar Connected")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    // Show connected calendar emails
                    Text(connectedCalendarsText)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                // Sync indicator or last synced
                if viewModel.isSyncing {
                    HStack(spacing: 4) {
                        ProgressView()
                            .scaleEffect(0.7)
                        Text("Syncing")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } else {
                    Button {
                        Task { await viewModel.syncCalendars() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.subheadline)
                            .foregroundColor(.blue)
                    }
                }
            }

            Text("Toggle on meetings you want to auto-record. Manage calendars in Settings.")
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .padding(.horizontal)
    }

    private var connectedCalendarsText: String {
        var calendars: [String] = []
        if let google = viewModel.googleConnection {
            calendars.append(google.providerEmail ?? "Google Calendar")
        }
        if let outlook = viewModel.outlookConnection {
            calendars.append(outlook.providerEmail ?? "Outlook")
        }
        return calendars.joined(separator: ", ")
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(spacing: 8) {
            Text("Get instant notes from your")
                .font(.title3)
                .foregroundColor(.primary)

            HStack(spacing: 4) {
                Text("Gmeet")
                    .foregroundColor(.blue)
                Text(",")
                Text("Teams")
                    .foregroundColor(.blue)
                Text("and")
                Text("Zoom")
                    .foregroundColor(.blue)
                Text("calls.")
            }
            .font(.title3)
            .fontWeight(.medium)

            Text("Connect your calendar and decide which meetings you want to record")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.top, 4)
        }
        .padding(.horizontal)
    }

    // MARK: - Calendar Connections Section (shown only when not connected)

    private var calendarConnectionsSection: some View {
        VStack(spacing: 12) {
            // Google Calendar
            CalendarConnectionRow(
                iconImage: Image(systemName: "calendar"),
                iconSystemName: "calendar",
                iconColor: .red,
                title: "Google Calendar",
                isConnected: false,
                connectedEmail: nil,
                isLoading: viewModel.isConnecting
            ) {
                Task { await viewModel.connectGoogleCalendar() }
            }

            // Microsoft Outlook
            CalendarConnectionRow(
                iconImage: nil,
                iconSystemName: "envelope.fill",
                iconColor: Color(red: 0, green: 0.47, blue: 0.95),
                title: "Microsoft Outlook",
                isConnected: false,
                connectedEmail: nil,
                isLoading: false
            ) {
                Task { await viewModel.connectOutlook() }
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Upcoming Meetings Section

    private var upcomingMeetingsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Upcoming Meetings")
                    .font(.headline)

                Spacer()

                Text("Next 14 days")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal)

            if viewModel.isLoadingMeetings {
                HStack {
                    Spacer()
                    ProgressView()
                        .padding()
                    Spacer()
                }
            } else if viewModel.meetings.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)

                    Text("No upcoming meetings with video calls")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    Text("Meetings with Zoom, Google Meet, or Teams links will appear here")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
                .padding(.horizontal)
            } else {
                LazyVStack(spacing: 12) {
                    ForEach(viewModel.meetings) { meeting in
                        MeetingCard(meeting: meeting, viewModel: viewModel)
                    }
                }
                .padding(.horizontal)
            }
        }
    }
}

// MARK: - Meeting Card

struct MeetingCard: View {
    let meeting: Meeting
    @ObservedObject var viewModel: CalendarViewModel
    @State private var isUpdating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header row
            HStack(alignment: .top) {
                // Date/time
                VStack(alignment: .leading, spacing: 2) {
                    Text(meeting.scheduledStart.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption)
                        .foregroundColor(.secondary)

                    Text(meeting.scheduledStart.formatted(date: .omitted, time: .shortened))
                        .font(.headline)
                }

                Spacer()

                // Platform badge
                if let platform = meeting.platform {
                    HStack(spacing: 4) {
                        Image(systemName: platformIcon(for: platform))
                            .font(.caption)
                        Text(platformName(for: platform))
                            .font(.caption)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.blue.opacity(0.1))
                    .foregroundColor(.blue)
                    .cornerRadius(6)
                }
            }

            // Title
            Text(meeting.title)
                .font(.body)
                .fontWeight(.medium)
                .lineLimit(2)

            // Join meeting button
            if let joinUrl = meeting.joinUrl, let url = URL(string: joinUrl) {
                Button(action: {
                    UIApplication.shared.open(url)
                }) {
                    HStack(spacing: 6) {
                        Image(systemName: "video.fill")
                            .font(.caption)
                        Text("Join Meeting")
                            .font(.subheadline)
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.green)
                    .foregroundColor(.white)
                    .cornerRadius(8)
                }
                .padding(.top, 2)
            }

            // Auto-join toggle
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Auto-record this meeting")
                        .font(.subheadline)

                    Text("Bot will join and transcribe")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()

                if isUpdating {
                    ProgressView()
                        .scaleEffect(0.8)
                } else {
                    Toggle("", isOn: Binding(
                        get: { meeting.autoJoin },
                        set: { newValue in
                            Task {
                                isUpdating = true
                                await viewModel.toggleAutoJoin(meetingId: meeting.id, enabled: newValue)
                                isUpdating = false
                            }
                        }
                    ))
                    .labelsHidden()
                    .tint(.blue)
                }
            }
            .padding(.top, 4)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func platformIcon(for platform: String) -> String {
        switch platform.lowercased() {
        case "zoom": return "video.fill"
        case "google_meet": return "video.fill"
        case "teams": return "video.fill"
        default: return "video.fill"
        }
    }

    private func platformName(for platform: String) -> String {
        switch platform.lowercased() {
        case "zoom": return "Zoom"
        case "google_meet": return "Google Meet"
        case "teams": return "Teams"
        case "webex": return "Webex"
        default: return platform.capitalized
        }
    }
}

// MARK: - Meeting Model

struct Meeting: Identifiable, Codable {
    let id: String
    let title: String
    let platform: String?
    let source: String
    let scheduledStart: Date
    let scheduledEnd: Date?
    let autoJoin: Bool
    let status: String
    let recordingId: String?
    let joinUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case platform
        case source
        case scheduledStart = "scheduled_start"
        case scheduledEnd = "scheduled_end"
        case autoJoin = "auto_join"
        case status
        case recordingId = "recording_id"
        case joinUrl = "join_url"
    }
}

struct MeetingsResponse: Codable {
    let items: [Meeting]
    let total: Int

    // Map items to meetings for convenience
    var meetings: [Meeting] { items }
}

// MARK: - Preview

#if DEBUG
struct MeetingsView_Previews: PreviewProvider {
    static var previews: some View {
        MeetingsView(viewModel: CalendarViewModel(apiClient: SummaryAIAPIClient()))
    }
}
#endif
