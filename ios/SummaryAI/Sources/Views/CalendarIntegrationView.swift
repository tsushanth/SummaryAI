import SwiftUI

// MARK: - Calendar Integration View

/// View for connecting calendar services (Google Calendar, Outlook)
struct CalendarIntegrationView: View {
    @ObservedObject var viewModel: CalendarViewModel

    var body: some View {
        VStack(spacing: 24) {
            // Header
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

            // Calendar connection options
            VStack(spacing: 12) {
                CalendarConnectionRow(
                    iconImage: Image("google-calendar-icon"),
                    iconSystemName: "calendar",
                    iconColor: .blue,
                    title: "Google Calendar",
                    isConnected: viewModel.googleConnection != nil,
                    connectedEmail: viewModel.googleConnection?.providerEmail,
                    isLoading: viewModel.isConnecting
                ) {
                    if viewModel.googleConnection != nil {
                        Task { await viewModel.disconnect(provider: "google") }
                    } else {
                        Task { await viewModel.connectGoogleCalendar() }
                    }
                }

                CalendarConnectionRow(
                    iconImage: nil,
                    iconSystemName: "envelope.fill",
                    iconColor: Color(red: 0, green: 0.47, blue: 0.95),
                    title: "Microsoft Outlook",
                    isConnected: viewModel.outlookConnection != nil,
                    connectedEmail: viewModel.outlookConnection?.providerEmail,
                    isLoading: false
                ) {
                    if viewModel.outlookConnection != nil {
                        Task { await viewModel.disconnect(provider: "microsoft") }
                    } else {
                        Task { await viewModel.connectOutlook() }
                    }
                }
            }
            .padding(.horizontal)

            // Learn more link
            Button {
                // Show more information
            } label: {
                Text("Learn more")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(.top, 32)
        .alert("Calendar", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) {
                viewModel.showError = false
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
    }
}

// MARK: - Calendar Connection Row

struct CalendarConnectionRow: View {
    let iconImage: Image?
    let iconSystemName: String
    let iconColor: Color
    let title: String
    let isConnected: Bool
    let connectedEmail: String?
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            // Icon
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.white)
                    .frame(width: 44, height: 44)
                    .shadow(color: .black.opacity(0.1), radius: 2, y: 1)

                if let iconImage = iconImage {
                    iconImage
                        .resizable()
                        .scaledToFit()
                        .frame(width: 28, height: 28)
                } else {
                    Image(systemName: iconSystemName)
                        .font(.system(size: 20))
                        .foregroundColor(iconColor)
                }
            }

            // Title and email
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                    .foregroundColor(.primary)

                if let email = connectedEmail {
                    Text(email)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Connect button
            Button(action: action) {
                if isLoading {
                    ProgressView()
                        .scaleEffect(0.8)
                        .frame(width: 80, height: 32)
                } else {
                    Text(isConnected ? "Disconnect" : "Connect")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(isConnected ? Color.gray : Color.blue)
                        .cornerRadius(8)
                }
            }
            .disabled(isLoading)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - Upcoming Meetings View

/// Shows upcoming meetings from connected calendars
struct UpcomingMeetingsView: View {
    let meetings: [CalendarMeeting]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Upcoming Meetings")
                .font(.headline)

            if meetings.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)

                    Text("No upcoming meetings")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
            } else {
                ForEach(meetings) { meeting in
                    MeetingRow(meeting: meeting)
                }
            }
        }
    }
}

// MARK: - Meeting Row

struct MeetingRow: View {
    let meeting: CalendarMeeting
    @State private var autoRecord = false

    var body: some View {
        HStack(spacing: 12) {
            // Time indicator
            VStack(spacing: 2) {
                Text(meeting.startTime.formatted(date: .omitted, time: .shortened))
                    .font(.caption)
                    .fontWeight(.semibold)

                Text(meeting.startTime.formatted(date: .abbreviated, time: .omitted))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            .frame(width: 60)

            // Meeting info
            VStack(alignment: .leading, spacing: 4) {
                Text(meeting.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    Image(systemName: meeting.platformIcon)
                        .font(.caption)

                    Text(meeting.platform)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Auto-record toggle
            Toggle("", isOn: $autoRecord)
                .labelsHidden()
                .tint(.blue)
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

// MARK: - Calendar Meeting Model

struct CalendarMeeting: Identifiable {
    let id: String
    let title: String
    let startTime: Date
    let endTime: Date
    let platform: String
    let meetingLink: String?

    var platformIcon: String {
        switch platform.lowercased() {
        case "zoom":
            return "video.fill"
        case "google meet", "gmeet", "google_meet":
            return "video.fill"
        case "teams", "microsoft teams":
            return "video.fill"
        default:
            return "calendar"
        }
    }

    var duration: TimeInterval {
        endTime.timeIntervalSince(startTime)
    }

    var formattedDuration: String {
        let minutes = Int(duration / 60)
        if minutes >= 60 {
            let hours = minutes / 60
            let remainingMinutes = minutes % 60
            return remainingMinutes > 0 ? "\(hours)h \(remainingMinutes)m" : "\(hours)h"
        }
        return "\(minutes)m"
    }
}

// MARK: - Preview

#if DEBUG
struct CalendarIntegrationView_Previews: PreviewProvider {
    static var previews: some View {
        CalendarIntegrationView(viewModel: CalendarViewModel(apiClient: SummaryAIAPIClient()))
    }
}
#endif
