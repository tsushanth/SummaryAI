import SwiftUI

/// Live insights panel shown during recording when AI Coach is active.
/// Subscribes to the SSE stream and renders insights as they arrive,
/// newest first. Color-coded by urgency.
@MainActor
final class CoachingLiveStream: ObservableObject {
    @Published var insights: [CoachingInsight] = []
    @Published var isActive: Bool = false

    private var streamTask: Task<Void, Never>?
    private(set) var sessionId: String?

    func start(sessionId: String) {
        guard self.sessionId != sessionId else { return }
        self.sessionId = sessionId
        self.isActive = true
        streamTask?.cancel()
        streamTask = Task { [weak self] in
            guard let self else { return }
            for await insight in CoachingClient.shared.streamInsights(sessionId: sessionId) {
                guard !Task.isCancelled else { return }
                self.insights.insert(insight, at: 0)
            }
            self.isActive = false
        }
    }

    func stop() async {
        streamTask?.cancel()
        streamTask = nil
        if let id = sessionId {
            _ = try? await CoachingClient.shared.endSession(sessionId: id)
        }
        sessionId = nil
        isActive = false
    }
}

struct CoachingLivePanel: View {
    @ObservedObject var stream: CoachingLiveStream
    @State private var isCollapsed = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isCollapsed.toggle() }
            } label: {
                HStack {
                    Image(systemName: "sparkles")
                        .foregroundColor(.purple)
                    Text("AI Coach")
                        .font(.subheadline.weight(.semibold))
                    if stream.isActive {
                        Circle()
                            .fill(.green)
                            .frame(width: 6, height: 6)
                    }
                    Spacer()
                    Image(systemName: isCollapsed ? "chevron.up" : "chevron.down")
                        .foregroundColor(.secondary)
                        .font(.caption)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if !isCollapsed {
                Divider()
                if stream.insights.isEmpty {
                    Text("Listening for tactical moments…")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding()
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(stream.insights) { insight in
                                CoachingInsightRow(insight: insight)
                            }
                        }
                        .padding(12)
                    }
                    .frame(maxHeight: 260)
                }
            }
        }
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.purple.opacity(0.3), lineWidth: 1)
        )
        .padding(.horizontal)
    }
}

struct CoachingInsightRow: View {
    let insight: CoachingInsight

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(urgencyColor)
                .frame(width: 8, height: 8)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 2) {
                Text(insight.text)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Text(insight.type.rawValue.capitalized)
                        .font(.caption2.weight(.semibold))
                        .foregroundColor(urgencyColor)
                    if let offset = insight.transcriptOffsetSeconds {
                        Text("· \(formatOffset(offset))")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }

    private var urgencyColor: Color {
        switch insight.urgency {
        case .now: return .red
        case .soon: return .orange
        case .beforeEnd: return .green
        }
    }

    private func formatOffset(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
