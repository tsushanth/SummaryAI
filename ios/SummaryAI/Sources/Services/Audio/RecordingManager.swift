import AVFoundation
import Foundation

// MARK: - Recording State

/// Represents the current state of the recording manager
enum RecordingState: Equatable {
    case idle
    case preparingToRecord
    case recording
    case paused
    case stopping
    case failed(RecordingError)

    var isRecording: Bool {
        self == .recording
    }

    var canStart: Bool {
        self == .idle
    }

    var canStop: Bool {
        self == .recording || self == .paused
    }

    static func == (lhs: RecordingState, rhs: RecordingState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle),
             (.preparingToRecord, .preparingToRecord),
             (.recording, .recording),
             (.paused, .paused),
             (.stopping, .stopping):
            return true
        case (.failed, .failed):
            return true
        default:
            return false
        }
    }
}

// MARK: - Recording Error

/// Errors that can occur during recording
enum RecordingError: Error, LocalizedError {
    case microphonePermissionDenied
    case microphonePermissionRestricted
    case audioSessionSetupFailed(Error)
    case recorderSetupFailed(Error)
    case recordingFailed(Error)
    case fileNotFound
    case unknown(Error)

    var errorDescription: String? {
        switch self {
        case .microphonePermissionDenied:
            return "Microphone access was denied. Please enable it in Settings."
        case .microphonePermissionRestricted:
            return "Microphone access is restricted on this device."
        case .audioSessionSetupFailed(let error):
            return "Failed to setup audio session: \(error.localizedDescription)"
        case .recorderSetupFailed(let error):
            return "Failed to setup recorder: \(error.localizedDescription)"
        case .recordingFailed(let error):
            return "Recording failed: \(error.localizedDescription)"
        case .fileNotFound:
            return "Recording file not found."
        case .unknown(let error):
            return "An unexpected error occurred: \(error.localizedDescription)"
        }
    }
}

// MARK: - Recording Result

/// Result of a completed recording
struct RecordingResult {
    let fileURL: URL
    let duration: TimeInterval
    let fileSize: Int64
    let createdAt: Date
}

// MARK: - Recording Manager

/// Manages audio recording with support for background recording and screen lock
@MainActor
final class RecordingManager: NSObject, ObservableObject {

    // MARK: - Published Properties

    @Published private(set) var state: RecordingState = .idle
    @Published private(set) var currentDuration: TimeInterval = 0
    @Published private(set) var audioLevel: Float = 0

    // MARK: - Private Properties

    private var audioRecorder: AVAudioRecorder?
    private var recordingStartTime: Date?
    private var accumulatedDuration: TimeInterval = 0
    private var durationTimer: Timer?
    private var levelTimer: Timer?
    private var currentRecordingURL: URL?

    private let audioSession = AVAudioSession.sharedInstance()

    // MARK: - Audio Settings

    /// Audio recording settings optimized for speech
    private let recordingSettings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
        AVSampleRateKey: 44100.0,
        AVNumberOfChannelsKey: 1,  // Mono for speech
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        AVEncoderBitRateKey: 128000  // 128 kbps
    ]

    // MARK: - Initialization

    override init() {
        super.init()
        setupNotifications()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - Permission Handling

    /// Check if microphone permission is granted
    var hasMicrophonePermission: Bool {
        AVAudioSession.sharedInstance().recordPermission == .granted
    }

    /// Request microphone permission
    /// - Returns: True if permission was granted
    func requestMicrophonePermission() async -> Bool {
        let status = audioSession.recordPermission

        switch status {
        case .granted:
            return true

        case .denied:
            return false

        case .undetermined:
            return await withCheckedContinuation { continuation in
                audioSession.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }

        @unknown default:
            return false
        }
    }

    // MARK: - Recording Control

    /// Start a new recording
    func startRecording() async throws {
        guard state.canStart else {
            throw RecordingError.recordingFailed(NSError(domain: "RecordingManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Cannot start recording in current state"]))
        }

        state = .preparingToRecord

        // Check permission
        guard await requestMicrophonePermission() else {
            let error = RecordingError.microphonePermissionDenied
            state = .failed(error)
            throw error
        }

        do {
            // Setup audio session for recording with background support
            try setupAudioSession()

            // Create recording file URL
            let fileURL = generateRecordingURL()
            currentRecordingURL = fileURL

            // Setup and start recorder
            try setupRecorder(at: fileURL)

            // Start recording
            guard audioRecorder?.record() == true else {
                throw RecordingError.recordingFailed(NSError(domain: "RecordingManager", code: -2, userInfo: [NSLocalizedDescriptionKey: "Failed to start recording"]))
            }

            // Update state and start timers
            recordingStartTime = Date()
            accumulatedDuration = 0
            state = .recording

            startTimers()

            print("[RecordingManager] Recording started: \(fileURL.lastPathComponent)")

        } catch let error as RecordingError {
            state = .failed(error)
            throw error
        } catch {
            let recordingError = RecordingError.unknown(error)
            state = .failed(recordingError)
            throw recordingError
        }
    }

    /// Stop the current recording
    /// - Returns: The recording result with file URL and duration
    func stopRecording() async throws -> RecordingResult {
        guard state.canStop else {
            throw RecordingError.recordingFailed(NSError(domain: "RecordingManager", code: -3, userInfo: [NSLocalizedDescriptionKey: "No active recording to stop"]))
        }

        state = .stopping
        stopTimers()

        // Calculate final duration
        let finalDuration: TimeInterval
        if state == .paused {
            finalDuration = accumulatedDuration
        } else if let startTime = recordingStartTime {
            finalDuration = accumulatedDuration + Date().timeIntervalSince(startTime)
        } else {
            finalDuration = currentDuration
        }

        // Stop recorder
        audioRecorder?.stop()

        // Get file info
        guard let fileURL = currentRecordingURL else {
            let error = RecordingError.fileNotFound
            state = .failed(error)
            throw error
        }

        // Verify file exists and get size
        let fileManager = FileManager.default
        guard fileManager.fileExists(atPath: fileURL.path) else {
            let error = RecordingError.fileNotFound
            state = .failed(error)
            throw error
        }

        let attributes = try fileManager.attributesOfItem(atPath: fileURL.path)
        let fileSize = attributes[.size] as? Int64 ?? 0

        // Reset state
        resetState()

        // Deactivate audio session
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)

        print("[RecordingManager] Recording stopped. Duration: \(finalDuration)s, Size: \(fileSize) bytes")

        return RecordingResult(
            fileURL: fileURL,
            duration: finalDuration,
            fileSize: fileSize,
            createdAt: Date()
        )
    }

    /// Pause the current recording
    func pauseRecording() {
        guard state == .recording else { return }

        audioRecorder?.pause()

        // Accumulate duration
        if let startTime = recordingStartTime {
            accumulatedDuration += Date().timeIntervalSince(startTime)
        }
        recordingStartTime = nil

        stopTimers()
        state = .paused

        print("[RecordingManager] Recording paused")
    }

    /// Resume a paused recording
    func resumeRecording() {
        guard state == .paused else { return }

        audioRecorder?.record()
        recordingStartTime = Date()

        startTimers()
        state = .recording

        print("[RecordingManager] Recording resumed")
    }

    /// Cancel and discard the current recording
    func cancelRecording() {
        stopTimers()
        audioRecorder?.stop()

        // Delete the recording file
        if let fileURL = currentRecordingURL {
            try? FileManager.default.removeItem(at: fileURL)
            print("[RecordingManager] Recording cancelled and file deleted")
        }

        resetState()
        try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Audio Session Setup

    /// Configure audio session for recording with background support
    private func setupAudioSession() throws {
        do {
            // Use playAndRecord category to allow background recording
            // Options:
            // - .defaultToSpeaker: Route audio to speaker (for playback)
            // - .allowBluetooth: Support Bluetooth headsets
            // - .mixWithOthers: Don't interrupt other audio (optional)
            try audioSession.setCategory(
                .playAndRecord,
                mode: .spokenAudio,  // Optimized for speech recording
                options: [.defaultToSpeaker, .allowBluetooth]
            )

            // Activate the session
            try audioSession.setActive(true)

            print("[RecordingManager] Audio session configured successfully")

        } catch {
            throw RecordingError.audioSessionSetupFailed(error)
        }
    }

    /// Setup the audio recorder
    private func setupRecorder(at url: URL) throws {
        do {
            audioRecorder = try AVAudioRecorder(url: url, settings: recordingSettings)
            audioRecorder?.delegate = self
            audioRecorder?.isMeteringEnabled = true  // Enable audio level metering
            audioRecorder?.prepareToRecord()

        } catch {
            throw RecordingError.recorderSetupFailed(error)
        }
    }

    // MARK: - File Management

    /// Generate a unique URL for the recording file
    private func generateRecordingURL() -> URL {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let recordingsFolder = documentsPath.appendingPathComponent("Recordings", isDirectory: true)

        // Create recordings folder if needed
        try? FileManager.default.createDirectory(at: recordingsFolder, withIntermediateDirectories: true)

        // Generate unique filename with timestamp
        let timestamp = ISO8601DateFormatter().string(from: Date())
            .replacingOccurrences(of: ":", with: "-")
        let filename = "recording_\(timestamp).m4a"

        return recordingsFolder.appendingPathComponent(filename)
    }

    // MARK: - Timers

    private func startTimers() {
        // Duration timer - updates every 100ms
        durationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateDuration()
            }
        }

        // Audio level timer - updates every 50ms
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.updateAudioLevel()
            }
        }
    }

    private func stopTimers() {
        durationTimer?.invalidate()
        durationTimer = nil
        levelTimer?.invalidate()
        levelTimer = nil
    }

    private func updateDuration() {
        guard state == .recording, let startTime = recordingStartTime else { return }
        currentDuration = accumulatedDuration + Date().timeIntervalSince(startTime)
    }

    private func updateAudioLevel() {
        guard state == .recording else {
            audioLevel = 0
            return
        }

        audioRecorder?.updateMeters()

        // Get average power in decibels (-160 to 0)
        let averagePower = audioRecorder?.averagePower(forChannel: 0) ?? -160

        // Convert to 0-1 range with some smoothing
        // -50 dB is roughly silence, 0 dB is max
        let normalizedLevel = max(0, min(1, (averagePower + 50) / 50))

        // Apply smoothing
        audioLevel = audioLevel * 0.7 + Float(normalizedLevel) * 0.3
    }

    // MARK: - State Management

    private func resetState() {
        audioRecorder = nil
        currentRecordingURL = nil
        recordingStartTime = nil
        accumulatedDuration = 0
        currentDuration = 0
        audioLevel = 0
        state = .idle
    }

    // MARK: - Notifications

    private func setupNotifications() {
        // Handle audio session interruptions (phone calls, alarms, etc.)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption),
            name: AVAudioSession.interruptionNotification,
            object: audioSession
        )

        // Handle route changes (headphones plugged/unplugged)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleRouteChange),
            name: AVAudioSession.routeChangeNotification,
            object: audioSession
        )
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
            return
        }

        Task { @MainActor in
            switch type {
            case .began:
                // Interruption started - pause recording
                print("[RecordingManager] Interruption began - pausing")
                if state == .recording {
                    pauseRecording()
                }

            case .ended:
                // Interruption ended - optionally resume
                print("[RecordingManager] Interruption ended")
                if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                    let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                    if options.contains(.shouldResume) && state == .paused {
                        // Re-activate session and resume
                        try? audioSession.setActive(true)
                        resumeRecording()
                    }
                }

            @unknown default:
                break
            }
        }
    }

    @objc private func handleRouteChange(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let reasonValue = userInfo[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonValue) else {
            return
        }

        print("[RecordingManager] Route change: \(reason)")

        // Handle specific route changes if needed
        switch reason {
        case .oldDeviceUnavailable:
            // Headphones unplugged - continue recording with built-in mic
            print("[RecordingManager] Old device unavailable, continuing with new route")
        default:
            break
        }
    }
}

// MARK: - AVAudioRecorderDelegate

extension RecordingManager: AVAudioRecorderDelegate {

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            if !flag && state == .recording {
                print("[RecordingManager] Recording finished unsuccessfully")
                state = .failed(.recordingFailed(NSError(domain: "RecordingManager", code: -4, userInfo: [NSLocalizedDescriptionKey: "Recording finished unsuccessfully"])))
            }
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in
            print("[RecordingManager] Encode error: \(error?.localizedDescription ?? "unknown")")
            if let error = error {
                state = .failed(.recordingFailed(error))
            }
        }
    }
}

// MARK: - Duration Formatting Extension

extension TimeInterval {
    /// Format duration as HH:MM:SS or MM:SS
    var formattedDuration: String {
        let hours = Int(self) / 3600
        let minutes = (Int(self) % 3600) / 60
        let seconds = Int(self) % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            return String(format: "%02d:%02d", minutes, seconds)
        }
    }
}
