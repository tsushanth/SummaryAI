import Foundation
import Combine
import RatingKit

// MARK: - Recording View State

/// Represents the current state of the recording view
enum RecordingViewState: Equatable {
    case idle
    case recording
    case paused
    case stopping
    case uploading(progress: Double)
    case processing
    case completed(Recording)
    case error(String)

    var canStartRecording: Bool {
        self == .idle || isError
    }

    var canStopRecording: Bool {
        self == .recording || self == .paused
    }

    var canPauseRecording: Bool {
        self == .recording
    }

    var canResumeRecording: Bool {
        self == .paused
    }

    var isRecording: Bool {
        self == .recording
    }

    var isError: Bool {
        if case .error = self { return true }
        return false
    }

    var isUploading: Bool {
        if case .uploading = self { return true }
        return false
    }

    static func == (lhs: RecordingViewState, rhs: RecordingViewState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle),
             (.recording, .recording),
             (.paused, .paused),
             (.stopping, .stopping),
             (.processing, .processing):
            return true
        case let (.uploading(p1), .uploading(p2)):
            return p1 == p2
        case let (.completed(r1), .completed(r2)):
            return r1.id == r2.id
        case let (.error(e1), .error(e2)):
            return e1 == e2
        default:
            return false
        }
    }
}

// MARK: - Recording View Model

/// View model for recording screen
/// Coordinates between RecordingManager and SummaryAIAPIClient
@MainActor
final class RecordingViewModel: ObservableObject {

    // MARK: - Published Properties

    @Published private(set) var state: RecordingViewState = .idle
    @Published private(set) var recordingDuration: TimeInterval = 0
    @Published private(set) var audioLevel: Float = 0
    @Published private(set) var uploadProgress: Double = 0
    @Published var recordingTitle: String = ""

    /// Whether microphone permission has been granted
    @Published private(set) var hasMicrophonePermission: Bool = false

    /// User-selected output language for the summary, persisted across launches.
    /// Display name as shown in the picker ("Auto", "English", "Spanish", ...).
    /// Pass nil/Auto to let the model default to English.
    @Published var selectedLanguageDisplay: String = UserDefaults.standard.string(forKey: RecordingViewModel.languagePrefKey) ?? "Auto" {
        didSet { UserDefaults.standard.set(selectedLanguageDisplay, forKey: RecordingViewModel.languagePrefKey) }
    }

    static let languagePrefKey = "com.meetingmind.outputLanguage"

    /// BCP-47 code for the selected language ("en", "es", ...). nil for "Auto".
    var selectedLanguageCode: String? {
        Self.languageCode(forDisplay: selectedLanguageDisplay)
    }

    /// Error message to display in alert
    @Published var errorMessage: String?
    @Published var showError: Bool = false
    @Published var showSubscriptionRequired: Bool = false

    // MARK: - Dependencies

    private let recordingManager: RecordingManager
    private let apiClient: SummaryAIAPIClient
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Private Properties

    private var currentRecordingResult: RecordingResult?
    /// Set when a background upload starts. Used to filter
    /// BackgroundUploadManager notifications and to drive retries.
    private var currentRecordingId: String?
    /// The Recording returned by createRecording, stashed so the notification
    /// handler can transition .processing → .completed once the background
    /// upload finalizes.
    private var pendingRecording: Recording?

    // MARK: - Initialization

    init(
        recordingManager: RecordingManager? = nil,
        apiClient: SummaryAIAPIClient
    ) {
        self.recordingManager = recordingManager ?? RecordingManager()
        self.apiClient = apiClient

        setupBindings()
        checkMicrophonePermission()
    }

    // MARK: - Setup

    private func setupBindings() {
        // Bind recording duration
        recordingManager.$currentDuration
            .receive(on: DispatchQueue.main)
            .assign(to: &$recordingDuration)

        // Bind audio level
        recordingManager.$audioLevel
            .receive(on: DispatchQueue.main)
            .assign(to: &$audioLevel)

        // Subscribe to background upload events so the UI can show progress
        // and react to completion / failure even though the actual PUT runs
        // outside this view-model's lifetime.
        NotificationCenter.default.publisher(for: BackgroundUploadManager.progressNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self = self,
                      let recordingId = notification.userInfo?["recordingId"] as? String,
                      recordingId == self.currentRecordingId,
                      let progress = notification.userInfo?["progress"] as? Double else { return }
                if case .uploading = self.state {
                    self.uploadProgress = progress
                    self.state = .uploading(progress: progress)
                }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: BackgroundUploadManager.didCompleteNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self = self,
                      let recordingId = notification.object as? String,
                      recordingId == self.currentRecordingId else { return }
                // Old flow transitioned .processing → .completed in immediate
                // succession; the view interprets .completed as "show success
                // checkmark + New Recording button". Without this the screen
                // sits on the spinner even though the recording is finished.
                if let recording = self.pendingRecording {
                    self.state = .completed(recording)
                } else {
                    self.state = .processing
                }
                self.currentRecordingResult = nil
                self.pendingRecording = nil
                RatingKit.shared.trackAction()
                print("[RecordingViewModel] Background upload finalized: \(recordingId)")
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: BackgroundUploadManager.didFailNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self = self,
                      let recordingId = notification.userInfo?["recordingId"] as? String,
                      recordingId == self.currentRecordingId else { return }
                let msg = (notification.userInfo?["error"] as? String) ?? "Upload failed"
                self.showError("Upload failed: \(msg)")
                self.state = .error(msg)
                print("[RecordingViewModel] Background upload failed, file retained for retry: \(recordingId)")
            }
            .store(in: &cancellables)

        // Sync recording manager state
        recordingManager.$state
            .receive(on: DispatchQueue.main)
            .sink { [weak self] managerState in
                self?.handleRecordingManagerStateChange(managerState)
            }
            .store(in: &cancellables)
    }

    private func handleRecordingManagerStateChange(_ managerState: RecordingState) {
        switch managerState {
        case .idle:
            // Only update to idle if we're not in upload/processing/completed state
            if case .recording = state { } else if case .paused = state { } else if case .stopping = state { } else {
                // Don't override upload/processing/completed states
            }
        case .recording:
            state = .recording
        case .paused:
            state = .paused
        case .stopping:
            state = .stopping
        case .preparingToRecord:
            // Transitional state, keep current state
            break
        case .failed(let error):
            showError(error.localizedDescription)
        }
    }

    // MARK: - Permission Handling

    /// Check current microphone permission status
    func checkMicrophonePermission() {
        hasMicrophonePermission = recordingManager.hasMicrophonePermission
    }

    /// Request microphone permission
    /// - Returns: True if permission was granted
    @discardableResult
    func requestMicrophonePermission() async -> Bool {
        let granted = await recordingManager.requestMicrophonePermission()
        hasMicrophonePermission = granted

        if !granted {
            showError("Microphone access is required to record. Please enable it in Settings.")
        }

        return granted
    }

    // MARK: - Recording Actions

    /// Start a new recording
    func startRecording() async {
        guard state.canStartRecording else { return }

        // Clear any previous error
        clearError()

        // Generate default title if empty
        if recordingTitle.isEmpty {
            recordingTitle = generateDefaultTitle()
        }

        do {
            try await recordingManager.startRecording()
            state = .recording
            AnalyticsService.shared.logRecordingStarted()
        } catch {
            showError(error.localizedDescription)
        }
    }

    /// Stop the current recording and start upload
    func stopRecording() async {
        guard state.canStopRecording else { return }

        state = .stopping

        do {
            // Stop recording and get result
            let result = try await recordingManager.stopRecording()
            currentRecordingResult = result

            // Start upload
            await uploadRecording(result: result)

        } catch {
            showError(error.localizedDescription)
        }
    }

    /// Pause the current recording
    func pauseRecording() {
        guard state.canPauseRecording else { return }
        recordingManager.pauseRecording()
    }

    /// Resume a paused recording
    func resumeRecording() {
        guard state.canResumeRecording else { return }
        recordingManager.resumeRecording()
    }

    /// Cancel and discard the current recording
    func cancelRecording() {
        recordingManager.cancelRecording()
        resetState()
    }

    // MARK: - Upload

    /// Hands the recording off to BackgroundUploadManager. The actual PUT
    /// happens in a background URLSession and survives backgrounding /
    /// suspension / app termination — we listen for progress + completion
    /// notifications and update view state accordingly.
    private func uploadRecording(result: RecordingResult) async {
        state = .uploading(progress: 0)
        uploadProgress = 0

        do {
            let recording = try await apiClient.uploadRecording(
                title: recordingTitle,
                fileURL: result.fileURL,
                duration: result.duration,
                outputLanguage: selectedLanguageCode,
                progressHandler: nil    // progress now comes from BackgroundUploadManager
            )

            currentRecordingId = recording.id
            pendingRecording = recording
            AnalyticsService.shared.logRecordingStopped(durationSeconds: Int(result.duration))
            print("[RecordingViewModel] Background upload kicked off for \(recording.id)")
            // The screen stays in .uploading until BackgroundUploadManager
            // posts didCompleteNotification (transitions to .processing) or
            // didFailNotification (transitions to .error).

        } catch APIError.subscriptionRequired, APIError.freeTierLimitReached {
            // Don't surface a paywall here — it interrupts the recording flow
            // and the user loses the in-memory context. The audio file is
            // retained on disk (we don't delete on this path), so a future
            // "pending uploads" scan or post-purchase retry can recover it.
            print("[RecordingViewModel] Subscription required — file retained at \(result.fileURL.path)")
            state = .error("You've reached the free tier limit. Subscribe to keep recording.")
        } catch {
            showError("Upload failed: \(error.localizedDescription)")
            state = .error(error.localizedDescription)
            print("[RecordingViewModel] createRecording failed, file retained: \(error)")
        }
    }

    /// Called by the view when the recording-limit paywall sheet dismisses.
    /// If the user actually bought a subscription, automatically retry the
    /// upload that was blocked — otherwise the local file would sit on disk
    /// with no UI path back, which was a real reported bug.
    func handlePaywallDismissed() async {
        await PremiumManager.shared.validateSubscriptionState()
        guard PremiumManager.shared.isPremium else { return }
        guard case .error = state else { return }
        guard let result = currentRecordingResult,
              FileManager.default.fileExists(atPath: result.fileURL.path) else { return }
        print("[RecordingViewModel] User became premium after paywall — retrying upload")
        clearError()
        await uploadRecording(result: result)
    }

    /// Retry upload for the current recording on this screen.
    func retryUpload() async {
        // Two cases: we have an in-memory recordingId (failed in this session,
        // user still on screen), or we don't (user navigated away and came
        // back). For the in-memory case ask BackgroundUploadManager to retry;
        // otherwise the global pending-uploads list on RecordingsListView
        // is the path back.
        if let recordingId = currentRecordingId,
           let pending = BackgroundUploadManager.shared.pendingUploads.first(where: { $0.id == recordingId }) {
            clearError()
            state = .uploading(progress: 0)
            uploadProgress = 0
            BackgroundUploadManager.shared.retry(pending)
            return
        }

        // Fallback: re-issue createRecording from the local audio file.
        guard let result = currentRecordingResult else {
            showError("No recording to upload")
            return
        }
        guard FileManager.default.fileExists(atPath: result.fileURL.path) else {
            showError("Recording file not found. Please record again.")
            currentRecordingResult = nil
            resetState()
            return
        }
        clearError()
        await uploadRecording(result: result)
    }

    // MARK: - State Management

    /// Reset to idle state for new recording
    func resetState() {
        state = .idle
        recordingDuration = 0
        audioLevel = 0
        uploadProgress = 0
        recordingTitle = ""
        currentRecordingResult = nil
        clearError()
    }

    /// Start a new recording (after completion)
    func startNewRecording() {
        resetState()
    }

    // MARK: - Error Handling

    private func showError(_ message: String) {
        errorMessage = message
        showError = true
        state = .error(message)
    }

    private func clearError() {
        errorMessage = nil
        showError = false
        if case .error = state {
            state = .idle
        }
    }

    // MARK: - Helpers

    /// Generate a default title based on current date/time
    private func generateDefaultTitle() -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return "Recording \(formatter.string(from: Date()))"
    }

    /// Format duration for display
    var formattedDuration: String {
        recordingDuration.formattedDuration
    }

    /// Format upload progress for display
    var formattedUploadProgress: String {
        "\(Int(uploadProgress * 100))%"
    }

    // MARK: - Language Picker Options

    /// Display names shown in the language picker.
    static let languageOptions: [String] = [
        "Auto", "English", "Spanish", "French", "German",
        "Portuguese", "Italian", "Hindi", "Chinese", "Japanese", "Korean",
    ]

    /// Map a picker display name to a BCP-47 code. "Auto" returns nil.
    static func languageCode(forDisplay display: String) -> String? {
        switch display {
        case "English": return "en"
        case "Spanish": return "es"
        case "French": return "fr"
        case "German": return "de"
        case "Portuguese": return "pt"
        case "Italian": return "it"
        case "Hindi": return "hi"
        case "Chinese": return "zh"
        case "Japanese": return "ja"
        case "Korean": return "ko"
        default: return nil
        }
    }

    /// Status text for current state
    var statusText: String {
        switch state {
        case .idle:
            return "Ready to record"
        case .recording:
            return "Recording..."
        case .paused:
            return "Paused"
        case .stopping:
            return "Stopping..."
        case .uploading(let progress):
            return "Uploading \(Int(progress * 100))%"
        case .processing:
            return "Processing on server..."
        case .completed:
            return "Complete!"
        case .error(let message):
            return message
        }
    }
}

// MARK: - Preview Helpers

#if DEBUG
extension RecordingViewModel {
    /// Create a view model in a specific state for previews
    static func preview(state: RecordingViewState) -> RecordingViewModel {
        let viewModel = RecordingViewModel(apiClient: SummaryAIAPIClient())
        viewModel.state = state
        return viewModel
    }
}
#endif
