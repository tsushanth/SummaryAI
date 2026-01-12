import SwiftUI

/// View displaying live transcript segments during a meeting
struct LiveTranscriptView: View {
    @ObservedObject var viewModel: LiveTranscriptViewModel

    /// Auto-scroll to bottom when new content arrives
    @State private var autoScroll: Bool = true

    // Speaker colors for visual distinction
    private let speakerColors: [Color] = [
        .blue,
        .green,
        .purple,
        .orange,
        .pink,
        .teal,
        .indigo,
        .red
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "waveform")
                    .foregroundColor(.blue)
                Text("Live Transcript")
                    .font(.headline)

                Spacer()

                // Auto-scroll toggle
                Button {
                    autoScroll.toggle()
                } label: {
                    Image(systemName: autoScroll ? "arrow.down.circle.fill" : "arrow.down.circle")
                        .foregroundColor(autoScroll ? .blue : .gray)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal)
            .padding(.vertical, 12)

            Divider()

            // Transcript content
            if viewModel.segments.isEmpty {
                emptyStateView
            } else {
                transcriptScrollView
            }
        }
        .background(Color(.systemGroupedBackground))
        .cornerRadius(12)
        .onAppear {
            viewModel.startPolling()
        }
        .onDisappear {
            viewModel.stopPolling()
        }
    }

    // MARK: - Subviews

    private var emptyStateView: some View {
        VStack(spacing: 12) {
            Image(systemName: "text.bubble")
                .font(.system(size: 40))
                .foregroundColor(.gray.opacity(0.5))

            Text("Waiting for transcript...")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Text("Transcript will appear here as the meeting progresses")
                .font(.caption)
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }

    private var transcriptScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(viewModel.segments) { segment in
                        LiveTranscriptSegmentRow(
                            segment: segment,
                            timestamp: viewModel.formatTimestamp(segment.startTimestamp),
                            speakerColor: speakerColors[viewModel.colorIndex(for: segment.speakerId) % speakerColors.count]
                        )
                        .id(segment.id)
                    }
                }
                .padding()
            }
            .onChange(of: viewModel.segments.count) { _ in
                if autoScroll, let lastId = viewModel.segments.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
        }
    }
}

// MARK: - Segment Row

private struct LiveTranscriptSegmentRow: View {
    let segment: LiveTranscriptSegment
    let timestamp: String
    let speakerColor: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            // Timestamp
            Text(timestamp)
                .font(.caption)
                .foregroundColor(.gray)
                .frame(width: 36, alignment: .leading)

            // Content
            VStack(alignment: .leading, spacing: 4) {
                // Speaker badge
                HStack(spacing: 4) {
                    if segment.isHost {
                        Image(systemName: "crown.fill")
                            .font(.caption2)
                    }
                    Text(speakerName)
                        .font(.caption)
                        .fontWeight(.medium)
                }
                .foregroundColor(speakerColor)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(speakerColor.opacity(0.15))
                .cornerRadius(8)

                // Transcript text
                Text(segment.segmentText)
                    .font(.body)
                    .foregroundColor(.primary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    private var speakerName: String {
        if let name = segment.speakerName, !name.isEmpty {
            return name
        }
        if let id = segment.speakerId {
            return "Speaker \(id)"
        }
        return "Unknown"
    }
}

// MARK: - Preview

#Preview {
    LiveTranscriptView(
        viewModel: LiveTranscriptViewModel(
            meetingId: "preview",
            apiClient: SummaryAIAPIClient()
        )
    )
    .frame(height: 400)
    .padding()
}
