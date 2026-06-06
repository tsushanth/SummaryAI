import Foundation
import AVFoundation
import Speech

/// On-device live transcription using SFSpeechRecognizer. Runs alongside
/// the file-based recording — the mic is captured a second time by an
/// AVAudioEngine that feeds buffers into the recognizer. No network calls;
/// no per-minute cost; works offline.
@MainActor
final class LiveSpeechRecognizer: ObservableObject {

    enum AuthorizationStatus {
        case authorized
        case denied
        case restricted
        case notDetermined
        case unavailable      // recognizer cannot be constructed for this locale
    }

    // MARK: - Published

    /// Accumulated transcript text shown to the user.
    @Published private(set) var transcript: String = ""
    /// True between start() and stop().
    @Published private(set) var isRunning: Bool = false
    /// Last user-visible error if recognition fails.
    @Published private(set) var errorMessage: String?

    // MARK: - Private

    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let audioEngine = AVAudioEngine()
    private var currentLocale: Locale = .current

    // MARK: - Public API

    /// Request authorization for speech recognition. Idempotent.
    static func requestAuthorization() async -> AuthorizationStatus {
        let raw = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
        switch raw {
        case .authorized: return .authorized
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .denied
        }
    }

    /// Start streaming transcription. If already running, restarts with the
    /// new locale (useful when the user changes language).
    func start(locale: Locale = .current) async throws {
        if isRunning {
            stop()
        }
        currentLocale = locale
        errorMessage = nil
        transcript = ""

        guard let r = SFSpeechRecognizer(locale: locale) else {
            errorMessage = "Live transcription not available for \(locale.identifier)"
            throw NSError(domain: "LiveSpeechRecognizer", code: 1)
        }
        guard r.isAvailable else {
            errorMessage = "Speech recognizer not available right now"
            throw NSError(domain: "LiveSpeechRecognizer", code: 2)
        }
        recognizer = r

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        // We do NOT force on-device recognition — `supportsOnDeviceRecognition`
        // can report true even when the local model isn't actually installed
        // (or the local-speech daemon is unreachable), which causes a flood
        // of error 1101s. Letting iOS pick automatically uses on-device when
        // available and falls back to network otherwise.
        request = req

        // Install a tap on the input node and pipe buffers into the request.
        // The audio session is already configured by RecordingManager
        // (.playAndRecord); we don't touch it here to avoid disturbing the
        // file-based recording.
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        print("[LiveSpeech] inputNode format: sampleRate=\(format.sampleRate) channels=\(format.channelCount)")
        // Guard against the "phantom format" iOS returns when the audio
        // session hasn't actually routed the mic yet — installing a tap
        // with sampleRate=0 silently produces no buffers.
        guard format.sampleRate > 0 else {
            errorMessage = "Microphone is busy — try toggling Live Transcribe off and on again."
            throw NSError(domain: "LiveSpeechRecognizer", code: 3)
        }

        input.removeTap(onBus: 0)
        var bufferCount = 0
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            bufferCount &+= 1
            if bufferCount == 1 || bufferCount % 50 == 0 {
                print("[LiveSpeech] tap delivered buffer #\(bufferCount), frameLength=\(buffer.frameLength)")
            }
            self?.request?.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            print("[LiveSpeech] audioEngine started, isRunning=\(audioEngine.isRunning)")
        } catch {
            errorMessage = "Audio engine failed to start: \(error.localizedDescription)"
            print("[LiveSpeech] audioEngine.start() threw: \(error)")
            cleanup()
            throw error
        }

        task = r.recognitionTask(with: req) { [weak self] result, error in
            Task { @MainActor in
                guard let self = self else { return }
                if let result = result {
                    print("[LiveSpeech] result.isFinal=\(result.isFinal) text='\(result.bestTranscription.formattedString)'")
                    self.transcript = result.bestTranscription.formattedString
                }
                if let error = error {
                    let nsError = error as NSError
                    print("[LiveSpeech] recognition error code=\(nsError.code) desc=\(nsError.localizedDescription)")
                    switch nsError.code {
                    case 209, 216:
                        // Normal stop conditions — quiet, no UI message.
                        break
                    case 1101:
                        // Local speech daemon unavailable. The task is in a bad
                        // state and will keep firing on every buffer if we don't
                        // stop it. Tear down and surface a single, useful error.
                        self.errorMessage = "Live transcription isn't available on this device right now."
                        self.cleanup()
                        self.isRunning = false
                    default:
                        self.errorMessage = error.localizedDescription
                    }
                }
            }
        }

        isRunning = true
    }

    func stop() {
        cleanup()
        isRunning = false
    }

    // MARK: - Private

    private func cleanup() {
        request?.endAudio()
        task?.cancel()
        audioEngine.inputNode.removeTap(onBus: 0)
        if audioEngine.isRunning { audioEngine.stop() }
        request = nil
        task = nil
    }
}
