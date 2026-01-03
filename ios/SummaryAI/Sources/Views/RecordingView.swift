import SwiftUI

// MARK: - Recording View Wrapper

/// Wrapper to inject the API client from environment into the view model
struct RecordingView: View {
    @EnvironmentObject var apiClient: SummaryAIAPIClient

    var body: some View {
        RecordingContentView(apiClient: apiClient)
    }
}

// MARK: - Recording Content View

/// Main recording view that allows users to record audio
struct RecordingContentView: View {
    @StateObject private var viewModel: RecordingViewModel
    @State private var showCancelConfirmation = false
    @State private var liveTranscribeEnabled = false
    @State private var selectedLanguage = "Auto"
    @State private var translateEnabled = false

    private let languages = ["Auto", "English", "Spanish", "French", "German", "Chinese", "Japanese", "Korean", "Portuguese", "Italian"]

    init(apiClient: SummaryAIAPIClient) {
        _viewModel = StateObject(wrappedValue: RecordingViewModel(apiClient: apiClient))
    }

    var body: some View {
        VStack(spacing: 0) {
            // Live transcribe header (when recording)
            if viewModel.state.isRecording {
                liveTranscribeHeader
            }

            VStack(spacing: 32) {
                Spacer()

                // Title input (only when not recording)
                if !viewModel.state.isRecording {
                    titleSection
                }

                // Duration display
                durationSection

                // Audio level indicator
                if viewModel.state.isRecording {
                    audioLevelIndicator
                }

                // Live transcript preview (when enabled)
                if viewModel.state.isRecording && liveTranscribeEnabled {
                    liveTranscriptPreview
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
        }
        .navigationTitle(viewModel.state.isRecording ? "" : "Record")
        .navigationBarTitleDisplayMode(.inline)
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

    // MARK: - Live Transcribe Header

    private var liveTranscribeHeader: some View {
        VStack(spacing: 12) {
            // Toggle row
            HStack {
                Text("Live Transcribe")
                    .font(.headline)

                Spacer()

                Toggle("", isOn: $liveTranscribeEnabled)
                    .labelsHidden()
                    .tint(.blue)
            }
            .padding(.horizontal)

            // Options row (when enabled)
            if liveTranscribeEnabled {
                HStack(spacing: 12) {
                    // Language picker
                    Menu {
                        ForEach(languages, id: \.self) { language in
                            Button {
                                selectedLanguage = language
                            } label: {
                                HStack {
                                    Text(language)
                                    if selectedLanguage == language {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "globe")
                            Text(selectedLanguage)
                            Image(systemName: "chevron.down")
                                .font(.caption)
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)
                    }

                    // Translate option
                    Menu {
                        Button("Off") { translateEnabled = false }
                        Button("English") { translateEnabled = true }
                    } label: {
                        HStack(spacing: 4) {
                            Text("Translate")
                            Image(systemName: "chevron.down")
                                .font(.caption)
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)
                    }

                    Spacer()

                    // Font size button
                    Button {
                        // Toggle font size
                    } label: {
                        Text("Aa")
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Color(.secondarySystemBackground))
                            .cornerRadius(8)
                    }
                }
                .padding(.horizontal)
            }

            Divider()
        }
        .padding(.top, 8)
        .background(Color(.systemBackground))
    }

    // MARK: - Live Transcript Preview

    private var liveTranscriptPreview: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Simulated live transcript
            Text("Listening...")
                .font(.caption)
                .foregroundColor(.blue)
                .italic()

            // Connection status (placeholder)
            if !viewModel.state.isRecording {
                HStack {
                    Text("Connection error")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    Spacer()

                    Button("Retry") {
                        // Retry connection
                    }
                    .font(.subheadline)
                    .foregroundColor(.blue)
                }
                .padding()
                .background(Color(.secondarySystemBackground))
                .cornerRadius(8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
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

    // MARK: - Audio Level Indicator (Live Waveform)

    private var audioLevelIndicator: some View {
        LiveWaveformView(audioLevel: viewModel.audioLevel)
            .frame(height: 100)
            .padding(.horizontal, 20)
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

// MARK: - Live Waveform View

/// Animated waveform visualization for recording
struct LiveWaveformView: View {
    let audioLevel: Float

    @State private var waveformData: [Float] = Array(repeating: 0.1, count: 50)
    @State private var animationTimer: Timer?

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 3) {
                ForEach(Array(waveformData.enumerated()), id: \.offset) { index, level in
                    WaveformBar(level: CGFloat(level), maxHeight: geometry.size.height)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onChange(of: audioLevel) { _, newLevel in
            updateWaveform(with: newLevel)
        }
        .onAppear {
            startAnimation()
        }
        .onDisappear {
            stopAnimation()
        }
    }

    private func updateWaveform(with level: Float) {
        // Shift all values left and add new level at the end
        var newData = waveformData
        newData.removeFirst()
        // Add some variation to make it look more natural
        let variation = Float.random(in: -0.1...0.1)
        let adjustedLevel = max(0.05, min(1.0, level + variation))
        newData.append(adjustedLevel)

        withAnimation(.linear(duration: 0.1)) {
            waveformData = newData
        }
    }

    private func startAnimation() {
        // Add subtle animation even when not receiving audio
        animationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            if audioLevel < 0.1 {
                // Add subtle movement when quiet
                let randomIndex = Int.random(in: 0..<waveformData.count)
                var newData = waveformData
                newData[randomIndex] = Float.random(in: 0.05...0.15)
                withAnimation(.easeInOut(duration: 0.1)) {
                    waveformData = newData
                }
            }
        }
    }

    private func stopAnimation() {
        animationTimer?.invalidate()
        animationTimer = nil
    }
}

// MARK: - Waveform Bar

struct WaveformBar: View {
    let level: CGFloat
    let maxHeight: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(barGradient)
            .frame(width: 4, height: barHeight)
    }

    private var barHeight: CGFloat {
        let minHeight: CGFloat = 4
        let height = max(minHeight, level * maxHeight)
        return min(height, maxHeight)
    }

    private var barGradient: LinearGradient {
        let colors: [Color]
        if level > 0.7 {
            colors = [.red, .orange]
        } else if level > 0.4 {
            colors = [.orange, .yellow]
        } else {
            colors = [.blue, .cyan]
        }
        return LinearGradient(colors: colors, startPoint: .bottom, endPoint: .top)
    }
}

// MARK: - Preview

#if DEBUG
struct RecordingView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationStack {
            RecordingView()
                .environmentObject(SummaryAIAPIClient())
        }
    }
}
#endif
