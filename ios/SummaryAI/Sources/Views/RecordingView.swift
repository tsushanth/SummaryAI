import SwiftUI

// MARK: - Recording View

/// Main recording view that allows users to record audio
struct RecordingView: View {
    @StateObject private var viewModel = RecordingViewModel()
    @State private var showCancelConfirmation = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Title input
            titleSection

            // Duration display
            durationSection

            // Audio level indicator
            if viewModel.state.isRecording {
                audioLevelIndicator
            }

            // Upload progress
            if viewModel.state.isUploading {
                uploadProgressSection
            }

            Spacer()

            // Status text
            Text(viewModel.statusText)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .padding(.bottom, 8)

            // Control buttons
            controlButtons

            Spacer()
        }
        .padding()
        .navigationTitle("Record")
        .alert("Error", isPresented: $viewModel.showError) {
            if case .error = viewModel.state {
                Button("Retry") {
                    Task { await viewModel.retryUpload() }
                }
                Button("Dismiss", role: .cancel) {
                    viewModel.resetState()
                }
            } else {
                Button("OK", role: .cancel) {}
            }
        } message: {
            Text(viewModel.errorMessage ?? "An error occurred")
        }
        .confirmationDialog(
            "Cancel Recording?",
            isPresented: $showCancelConfirmation,
            titleVisibility: .visible
        ) {
            Button("Cancel Recording", role: .destructive) {
                viewModel.cancelRecording()
            }
            Button("Continue Recording", role: .cancel) {}
        } message: {
            Text("Your recording will be discarded.")
        }
        .task {
            await viewModel.requestMicrophonePermission()
        }
    }

    // MARK: - Title Section

    private var titleSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Recording Title")
                .font(.caption)
                .foregroundColor(.secondary)

            TextField("Enter title", text: $viewModel.recordingTitle)
                .textFieldStyle(.roundedBorder)
                .disabled(!viewModel.state.canStartRecording)
        }
        .padding(.horizontal)
    }

    // MARK: - Duration Section

    private var durationSection: some View {
        VStack(spacing: 8) {
            Text(viewModel.formattedDuration)
                .font(.system(size: 64, weight: .thin, design: .monospaced))
                .foregroundColor(viewModel.state.isRecording ? .red : .primary)

            // Pulsing dot when recording
            if viewModel.state.isRecording {
                Circle()
                    .fill(.red)
                    .frame(width: 12, height: 12)
                    .modifier(PulsingModifier())
            }
        }
    }

    // MARK: - Audio Level Indicator

    private var audioLevelIndicator: some View {
        HStack(spacing: 4) {
            ForEach(0..<20, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(barColor(for: index))
                    .frame(width: 8, height: barHeight(for: index))
            }
        }
        .frame(height: 40)
        .animation(.easeOut(duration: 0.1), value: viewModel.audioLevel)
    }

    private func barColor(for index: Int) -> Color {
        let threshold = Float(index) / 20.0
        if viewModel.audioLevel > threshold {
            if index > 15 {
                return .red
            } else if index > 10 {
                return .yellow
            }
            return .green
        }
        return .gray.opacity(0.3)
    }

    private func barHeight(for index: Int) -> CGFloat {
        let threshold = Float(index) / 20.0
        let active = viewModel.audioLevel > threshold
        return active ? 40 : 20
    }

    // MARK: - Upload Progress Section

    private var uploadProgressSection: some View {
        VStack(spacing: 12) {
            ProgressView(value: viewModel.uploadProgress)
                .progressViewStyle(.linear)
                .padding(.horizontal, 40)

            Text(viewModel.formattedUploadProgress)
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    // MARK: - Control Buttons

    private var controlButtons: some View {
        HStack(spacing: 40) {
            // Cancel button (only when recording/paused)
            if viewModel.state.canStopRecording {
                Button {
                    showCancelConfirmation = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 44))
                        .foregroundColor(.gray)
                }
            }

            // Main record/stop button
            mainButton

            // Pause/resume button (only when recording/paused)
            if viewModel.state.canPauseRecording || viewModel.state.canResumeRecording {
                Button {
                    if viewModel.state.canPauseRecording {
                        viewModel.pauseRecording()
                    } else {
                        viewModel.resumeRecording()
                    }
                } label: {
                    Image(systemName: viewModel.state.canPauseRecording ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 44))
                        .foregroundColor(.blue)
                }
            }
        }
        .padding(.bottom, 40)
    }

    @ViewBuilder
    private var mainButton: some View {
        switch viewModel.state {
        case .idle, .error:
            // Record button
            Button {
                Task { await viewModel.startRecording() }
            } label: {
                ZStack {
                    Circle()
                        .stroke(.red, lineWidth: 4)
                        .frame(width: 80, height: 80)

                    Circle()
                        .fill(.red)
                        .frame(width: 64, height: 64)
                }
            }
            .disabled(!viewModel.hasMicrophonePermission)

        case .recording, .paused:
            // Stop button
            Button {
                Task { await viewModel.stopRecording() }
            } label: {
                ZStack {
                    Circle()
                        .stroke(.red, lineWidth: 4)
                        .frame(width: 80, height: 80)

                    RoundedRectangle(cornerRadius: 4)
                        .fill(.red)
                        .frame(width: 32, height: 32)
                }
            }

        case .stopping, .uploading, .processing:
            // Loading indicator
            ProgressView()
                .scaleEffect(2)
                .frame(width: 80, height: 80)

        case .completed:
            // Success checkmark with new recording button
            VStack(spacing: 16) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 64))
                    .foregroundColor(.green)

                Button("New Recording") {
                    viewModel.startNewRecording()
                }
                .buttonStyle(.borderedProminent)
            }
        }
    }
}

// MARK: - Pulsing Modifier

private struct PulsingModifier: ViewModifier {
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        content
            .opacity(isPulsing ? 0.3 : 1.0)
            .animation(
                .easeInOut(duration: 0.8)
                .repeatForever(autoreverses: true),
                value: isPulsing
            )
            .onAppear {
                isPulsing = true
            }
    }
}

// MARK: - Preview

#if DEBUG
struct RecordingView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            RecordingView()
        }
    }
}
#endif
