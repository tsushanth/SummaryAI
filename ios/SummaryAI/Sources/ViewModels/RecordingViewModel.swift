import Foundation
import Combine

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

    /// Error message to display in alert
    @Published var errorMessage: String?
    @Published var showError: Bool = false

    // MARK: - Dependencies

    private let recordingManager: RecordingManager
    private let apiClient: SummaryAIAPIClient
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Private Properties

    private var currentRecordingResult: RecordingResult?

    // MARK: - Initialization

    init(
        recordingManager: RecordingManager = RecordingManager(),
        apiClient: SummaryAIAPIClient = SummaryAIAPIClient()
    ) {
        self.recordingManager = recordingManager
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

        // Bind upload progress from API client
        apiClient.$uploadProgress
            .compactMap { $0?.fractionCompleted }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] progress in
                if case .uploading = self?.state {
                    self?.uploadProgress = progress
                    self?.state = .uploading(progress: progress)
                }
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

    /// Upload the recording to the server
    private func uploadRecording(result: RecordingResult) async {
        state = .uploading(progress: 0)
        uploadProgress = 0

        do {
            let recording = try await apiClient.uploadRecording(
                title: recordingTitle,
                fileURL: result.fileURL,
                duration: result.duration,
                progressHandler: { [weak self] progress in
                    Task { @MainActor in
                        self?.uploadProgress = progress.fractionCompleted
                        self?.state = .uploading(progress: progress.fractionCompleted)
                    }
                }
            )

            // Upload complete, now processing on server
            state = .processing

            // Clean up local file after successful upload
            try? FileManager.default.removeItem(at: result.fileURL)

            // Mark as completed
            state = .completed(recording)

            print("[RecordingViewModel] Recording uploaded and processing: \(recording.id)")

        } catch {
            showError("Upload failed: \(error.localizedDescription)")

            // Keep the local file for retry
            print("[RecordingViewModel] Upload failed, keeping local file for retry")
        }
    }

    /// Retry upload for the last recording
    func retryUpload() async {
        guard let result = currentRecordingResult else {
            showError("No recording to upload")
            return
        }

        // Verify file still exists
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
        let viewModel = RecordingViewModel()
        viewModel.state = state
        return viewModel
    }
}
#endif
