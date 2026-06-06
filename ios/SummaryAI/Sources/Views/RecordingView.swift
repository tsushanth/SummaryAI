import SwiftUI
import Combine
import PaywallKit
#if canImport(Translation)
import Translation
#endif

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
    @StateObject private var liveSpeech = LiveSpeechRecognizer()
    @State private var showCancelConfirmation = false
    @State private var liveTranscribeEnabled = false
    @State private var translateEnabled = false
    @State private var showRecordingLimitPaywall = false
    @State private var speechAuthorized = false
    @State private var translatedText: String = ""
    // Mirror of liveSpeech.transcript so the View body recomputes on update.
    // Some @MainActor-isolated @Published properties don't propagate cleanly
    // through SwiftUI's dependency tracking; subscribing via .onReceive avoids
    // that fragility.
    @State private var liveTranscript: String = ""

    private var languages: [String] { RecordingViewModel.languageOptions }

    /// Maximum number of recordings allowed for free users
    private static let freeRecordingLimit = 3
    private static let recordingCountKey = "com.meetingmind.recordingCount"

    init(apiClient: SummaryAIAPIClient) {
        _viewModel = StateObject(wrappedValue: RecordingViewModel(apiClient: apiClient))
    }

    /// Check if free user has exceeded the recording limit
    private var hasReachedRecordingLimit: Bool {
        guard !PremiumManager.shared.isPremium else { return false }
        let count = UserDefaults.standard.integer(forKey: Self.recordingCountKey)
        return count >= Self.freeRecordingLimit
    }

    /// Increment recording count after a successful recording start
    private func incrementRecordingCount() {
        let count = UserDefaults.standard.integer(forKey: Self.recordingCountKey) + 1
        UserDefaults.standard.set(count, forKey: Self.recordingCountKey)
    }

    /// Start or stop the on-device speech recognizer based on the toggle +
    /// recording state. Uses the language code the user picked for summary;
    /// if recognition isn't available for that locale we just stay silent.
    private func syncLiveSpeech(enabled: Bool) async {
        guard speechAuthorized else {
            print("[LiveTranscribe] syncLiveSpeech ignored — speech recognition NOT authorized")
            return
        }
        if enabled {
            let code = viewModel.selectedLanguageCode ?? Locale.current.language.languageCode?.identifier ?? "en"
            let locale = Locale(identifier: code)
            print("[LiveTranscribe] Starting live speech recognizer for locale=\(locale.identifier)")
            do {
                try await liveSpeech.start(locale: locale)
                print("[LiveTranscribe] Recognizer started; isRunning=\(liveSpeech.isRunning)")
            } catch {
                print("[LiveTranscribe] Recognizer FAILED to start: \(error.localizedDescription)")
            }
        } else {
            print("[LiveTranscribe] Stopping recognizer")
            liveSpeech.stop()
        }
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

                // Live transcript preview — sits in place of the bottom
                // Spacer when active, so it gets real estate instead of
                // being squeezed by a fully-expanded Spacer below it.
                if viewModel.state.isRecording && liveTranscribeEnabled {
                    liveTranscriptPreview
                } else {
                    Spacer()
                }
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
            let status = await LiveSpeechRecognizer.requestAuthorization()
            speechAuthorized = (status == .authorized)
            print("[LiveTranscribe] Speech recognition auth status: \(status), authorized=\(speechAuthorized)")
        }
        // Start/stop on-device live transcription based on the toggle + recording state.
        .onChange(of: liveTranscribeEnabled) { enabled in
            Task { await syncLiveSpeech(enabled: enabled) }
        }
        .onChange(of: viewModel.state.isRecording) { isRecording in
            Task { await syncLiveSpeech(enabled: liveTranscribeEnabled && isRecording) }
        }
        .onChange(of: viewModel.selectedLanguageDisplay) { _ in
            // Locale changed mid-session — restart the recognizer.
            Task {
                if liveSpeech.isRunning {
                    await syncLiveSpeech(enabled: false)
                    await syncLiveSpeech(enabled: liveTranscribeEnabled && viewModel.state.isRecording)
                }
            }
        }
        // Paywall used to surface here on free-tier limit, but it interrupted
        // the recording flow and caused users to lose context. We now show a
        // non-blocking error in the recording view-model instead; users can
        // subscribe via Settings / Recordings PRO badge and we'll retry
        // orphan recordings from disk in a future pass.
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
                    // Language picker — bound to view model so the choice is persisted.
                    // Picker-inside-Menu is the SwiftUI-native pattern; it gets correct
                    // checkmarks + tap highlighting automatically.
                    Menu {
                        Picker("Language", selection: $viewModel.selectedLanguageDisplay) {
                            ForEach(languages, id: \.self) { language in
                                Text(language).tag(language)
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "globe")
                            Text(viewModel.selectedLanguageDisplay)
                            Image(systemName: "chevron.down")
                                .font(.caption)
                        }
                        .font(.subheadline)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)
                    }

                    // Translate option — pill label now reflects the current selection.
                    Menu {
                        Picker("Translate", selection: $translateEnabled) {
                            Text("Off").tag(false)
                            Text("English").tag(true)
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(translateEnabled ? "English" : "Translate")
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
        // Read both the @StateObject-backed property AND the @State mirror.
        // SwiftUI dependency tracking has been inconsistent here — one of
        // the two reads will reliably trigger a body re-render.
        let liveText = !liveSpeech.transcript.isEmpty ? liveSpeech.transcript : liveTranscript
        let showTranslation = translateEnabled && !translatedText.isEmpty
        let displayedText = showTranslation ? translatedText : liveText

        return Group {
            if let err = liveSpeech.errorMessage {
                Text(err)
                    .font(.caption)
                    .foregroundColor(.red)
            } else if displayedText.isEmpty {
                Text("Listening…")
                    .font(.caption)
                    .foregroundColor(.blue)
                    .italic()
            } else {
                // Plain Text view, no scrolling — replaces in place as the
                // recognizer streams partials. Truncates from the head so
                // the most recent words are always visible.
                Text(displayedText)
                    .font(.callout)
                    .lineLimit(4)
                    .truncationMode(.head)
                    .multilineTextAlignment(.leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(8)
        .padding(.horizontal)
        .onReceive(liveSpeech.$transcript.receive(on: DispatchQueue.main)) { newValue in
            liveTranscript = newValue
        }
        .modifier(LiveTranslationModifier(
            enabled: translateEnabled,
            sourceCode: viewModel.selectedLanguageCode,    // nil = Auto (auto-detect)
            transcript: liveTranscript,
            translatedText: $translatedText
        ))
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

            HStack {
                Text("Summary Language")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Menu {
                    ForEach(languages, id: \.self) { language in
                        Button {
                            viewModel.selectedLanguageDisplay = language
                        } label: {
                            HStack {
                                Text(language)
                                if viewModel.selectedLanguageDisplay == language {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "globe")
                        Text(viewModel.selectedLanguageDisplay)
                        Image(systemName: "chevron.down").font(.caption2)
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(8)
                }
            }
            .padding(.top, 4)
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
            // Record button — no client-side paywall gate; backend enforces
            // the subscription rule when the user attempts to upload.
            Button {
                incrementRecordingCount()
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

// MARK: - Live Translation

/// Driver for live English translation of the recognized transcript.
/// iOS 17.4+ uses Apple's on-device Translation framework; older iOS is
/// a no-op so the view falls back to the source text.
private struct LiveTranslationModifier: ViewModifier {
    let enabled: Bool
    let sourceCode: String?    // nil = auto-detect
    let transcript: String
    @Binding var translatedText: String

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *), enabled {
            content.modifier(TranslationActiveModifier(
                sourceCode: sourceCode,
                transcript: transcript,
                translatedText: $translatedText
            ))
        } else {
            content
        }
    }
}

@available(iOS 18.0, *)
private struct TranslationActiveModifier: ViewModifier {
    let sourceCode: String?
    let transcript: String
    @Binding var translatedText: String

    @State private var configuration: TranslationSession.Configuration?
    @StateObject private var translator = LiveTranslator()

    func body(content: Content) -> some View {
        content
            .translationTask(configuration) { session in
                translator.bind(session: session)
                // The session lives for the lifetime of this task. Park here
                // until SwiftUI cancels us (configuration change or unmount).
                for await _ in AsyncStream<Never> { _ in } { }
            }
            .onAppear { rebuildConfig() }
            .onChange(of: sourceCode) { _ in
                translator.reset()
                rebuildConfig()
            }
            .onChange(of: transcript) { newValue in
                translator.submit(newValue)
            }
            .onChange(of: translator.translatedText) { newValue in
                translatedText = newValue
            }
            .onDisappear {
                translator.reset()
                translatedText = ""
            }
    }

    private func rebuildConfig() {
        let source: Locale.Language? = sourceCode.map { Locale.Language(identifier: $0) }
        configuration = TranslationSession.Configuration(
            source: source,
            target: Locale.Language(identifier: "en")
        )
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
