import SwiftUI

// MARK: - Processing Progress View

/// Animated step-by-step processing progress view
struct ProcessingProgressView: View {
    let status: RecordingStatus
    let onComplete: () -> Void

    @State private var showCompletion = false

    private var steps: [ProcessingStep] {
        [
            ProcessingStep(title: "Processing Audio", isCompleted: status.rawValue >= RecordingStatus.uploaded.rawValue),
            ProcessingStep(title: "Transcribing", isCompleted: status.rawValue >= RecordingStatus.transcribed.rawValue),
            ProcessingStep(title: "Identifying Speakers", isCompleted: status.rawValue >= RecordingStatus.transcribed.rawValue),
            ProcessingStep(title: "Highlighting key points", isCompleted: status == .completed),
            ProcessingStep(title: "Wrapping up", isCompleted: status == .completed)
        ]
    }

    private var currentStepIndex: Int {
        switch status {
        case .pending, .uploading:
            return 0
        case .uploaded, .transcribing:
            return 1
        case .transcribed, .summarizing:
            return 3
        case .completed:
            return 5
        case .failed:
            return -1
        }
    }

    private var progress: Double {
        switch status {
        case .pending:
            return 0.05
        case .uploading:
            return 0.15
        case .uploaded:
            return 0.25
        case .transcribing:
            return 0.45
        case .transcribed:
            return 0.65
        case .summarizing:
            return 0.85
        case .completed:
            return 1.0
        case .failed:
            return 0.0
        }
    }

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            if showCompletion {
                completionView
            } else {
                progressView
            }

            Spacer()

            if showCompletion {
                Button {
                    onComplete()
                } label: {
                    Text("Enjoy Summary")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(Color.blue)
                        .foregroundColor(.white)
                        .cornerRadius(16)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
            }
        }
        .onChange(of: status) { _, newStatus in
            if newStatus == .completed {
                withAnimation(.easeInOut(duration: 0.5).delay(0.5)) {
                    showCompletion = true
                }
            }
        }
        .onAppear {
            if status == .completed {
                showCompletion = true
            }
        }
    }

    // MARK: - Progress View

    private var progressView: some View {
        VStack(spacing: 24) {
            // Back button placeholder for navigation
            HStack {
                Button {
                    // Handle back navigation
                } label: {
                    Image(systemName: "arrow.left")
                        .font(.title2)
                        .foregroundColor(.primary)
                }
                Spacer()
            }
            .padding(.horizontal)

            Spacer()

            // Steps list
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    ProcessingStepRow(
                        step: step,
                        isActive: index == currentStepIndex,
                        progress: index == currentStepIndex ? progress : nil
                    )

                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(Color.gray.opacity(0.2))
                            .frame(width: 2, height: 16)
                            .padding(.leading, 19)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 24)
            .background(Color(.systemBackground))
            .cornerRadius(16)
            .shadow(color: .black.opacity(0.05), radius: 10, y: 4)
            .padding(.horizontal, 24)

            Spacer()
            Spacer()
        }
    }

    // MARK: - Completion View

    private var completionView: some View {
        VStack(spacing: 24) {
            // Completed steps
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    ProcessingStepRow(
                        step: ProcessingStep(title: step.title, isCompleted: true),
                        isActive: false,
                        progress: nil
                    )

                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(Color.gray.opacity(0.2))
                            .frame(width: 2, height: 16)
                            .padding(.leading, 19)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 24)
            .background(Color(.systemBackground))
            .cornerRadius(16)
            .shadow(color: .black.opacity(0.05), radius: 10, y: 4)
            .padding(.horizontal, 24)

            // Success indicator
            VStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(Color.blue)
                        .frame(width: 80, height: 80)

                    Image(systemName: "checkmark")
                        .font(.system(size: 36, weight: .bold))
                        .foregroundColor(.white)
                }

                Text("All done!")
                    .font(.title)
                    .fontWeight(.bold)

                Text("Your summary and transcript are ready!")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding(.top, 32)
        }
    }
}

// MARK: - Processing Step Model

struct ProcessingStep {
    let title: String
    let isCompleted: Bool
}

// MARK: - Processing Step Row

struct ProcessingStepRow: View {
    let step: ProcessingStep
    let isActive: Bool
    let progress: Double?

    var body: some View {
        HStack(spacing: 16) {
            // Step indicator
            ZStack {
                if step.isCompleted {
                    Circle()
                        .fill(Color.blue)
                        .frame(width: 40, height: 40)

                    Image(systemName: "checkmark")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                } else if isActive {
                    // Animated progress circle
                    Circle()
                        .stroke(Color.gray.opacity(0.2), lineWidth: 3)
                        .frame(width: 40, height: 40)

                    Circle()
                        .trim(from: 0, to: progress ?? 0)
                        .stroke(Color.blue, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .frame(width: 40, height: 40)
                        .rotationEffect(.degrees(-90))
                        .animation(.easeInOut(duration: 0.3), value: progress)
                } else {
                    Circle()
                        .stroke(Color.gray.opacity(0.3), lineWidth: 2)
                        .frame(width: 40, height: 40)
                }
            }

            // Step title
            VStack(alignment: .leading, spacing: 4) {
                Text(step.title)
                    .font(.body)
                    .fontWeight(isActive ? .semibold : .regular)
                    .foregroundColor(step.isCompleted || isActive ? .primary : .secondary)

                if isActive, let progress = progress {
                    Text("\(Int(progress * 100))%")
                        .font(.caption)
                        .foregroundColor(.blue)
                }
            }

            Spacer()
        }
    }
}

// MARK: - Compact Processing Banner

/// A compact processing banner for showing in list views
struct ProcessingBanner: View {
    let status: RecordingStatus

    var body: some View {
        HStack(spacing: 12) {
            // Animated spinner
            ProgressView()
                .scaleEffect(0.8)

            VStack(alignment: .leading, spacing: 2) {
                Text(statusTitle)
                    .font(.subheadline)
                    .fontWeight(.medium)

                Text(statusSubtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            // Progress percentage
            Text("\(Int(progressPercentage))%")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.blue)
        }
        .padding()
        .background(Color.blue.opacity(0.1))
        .cornerRadius(12)
    }

    private var statusTitle: String {
        switch status {
        case .pending:
            return "Preparing..."
        case .uploading:
            return "Uploading..."
        case .uploaded:
            return "Processing..."
        case .transcribing:
            return "Transcribing..."
        case .transcribed:
            return "Analyzing..."
        case .summarizing:
            return "Summarizing..."
        case .completed:
            return "Complete!"
        case .failed:
            return "Failed"
        }
    }

    private var statusSubtitle: String {
        switch status {
        case .pending:
            return "Getting ready to process"
        case .uploading:
            return "Uploading your recording"
        case .uploaded:
            return "Processing audio file"
        case .transcribing:
            return "Converting speech to text"
        case .transcribed:
            return "Identifying speakers"
        case .summarizing:
            return "Generating summary and key points"
        case .completed:
            return "Your summary is ready"
        case .failed:
            return "Something went wrong"
        }
    }

    private var progressPercentage: Double {
        switch status {
        case .pending:
            return 5
        case .uploading:
            return 15
        case .uploaded:
            return 25
        case .transcribing:
            return 50
        case .transcribed:
            return 70
        case .summarizing:
            return 90
        case .completed:
            return 100
        case .failed:
            return 0
        }
    }
}

// MARK: - Preview

#if DEBUG
struct ProcessingProgressView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ProcessingProgressView(status: .transcribing) {}
                .previewDisplayName("Processing")

            ProcessingProgressView(status: .completed) {}
                .previewDisplayName("Completed")

            ProcessingBanner(status: .transcribing)
                .padding()
                .previewDisplayName("Banner")
        }
    }
}
#endif
