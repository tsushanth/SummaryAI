//
//  VoipService.swift
//  SummaryAI
//
//  Service for managing VoIP calls using Twilio Voice SDK
//

import Foundation
import AVFoundation
import TwilioVoice

/// Reason why a call ended
enum CallEndReason: String {
    case completed = "Call ended"
    case declined = "Call was declined"
    case busy = "Line is busy"
    case noAnswer = "No answer"
    case cancelled = "Call cancelled"
    case failed = "Call failed"
    case unknown = "Unknown"
}

/// VoIP call state
enum VoipCallState: Equatable {
    case idle
    case connecting
    case ringing
    case connected
    case disconnected(reason: CallEndReason, message: String?)
    case failed(error: String)

    static func == (lhs: VoipCallState, rhs: VoipCallState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.connecting, .connecting), (.ringing, .ringing), (.connected, .connected):
            return true
        case (.disconnected(let r1, _), .disconnected(let r2, _)):
            return r1 == r2
        case (.failed(let e1), .failed(let e2)):
            return e1 == e2
        default:
            return false
        }
    }
}

/// Service for managing VoIP calls using Twilio Voice SDK
@MainActor
class VoipService: NSObject, ObservableObject {
    static let shared = VoipService()

    @Published private(set) var callState: VoipCallState = .idle
    @Published private(set) var isMuted: Bool = false
    @Published private(set) var isSpeakerOn: Bool = false

    private var activeCall: Call?
    private var accessToken: String?
    private let audioDevice = DefaultAudioDevice()

    private override init() {
        super.init()
        // Configure Twilio audio device
        TwilioVoiceSDK.audioDevice = audioDevice
    }

    /// Set the access token for VoIP calls
    func setAccessToken(_ token: String) {
        accessToken = token
        print("[VoipService] Access token set")
    }

    /// Make an outbound VoIP call
    /// - Parameters:
    ///   - callId: The call ID from our backend
    ///   - toNumber: The phone number to call (for display purposes)
    /// - Returns: true if call was initiated successfully
    func makeCall(callId: String, toNumber: String) -> Bool {
        guard let token = accessToken else {
            print("[VoipService] No access token set")
            callState = .failed(error: "No access token")
            return false
        }

        guard activeCall == nil else {
            print("[VoipService] Call already in progress")
            return false
        }

        // Request microphone permission
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            guard granted else {
                DispatchQueue.main.async {
                    self?.callState = .failed(error: "Microphone permission denied")
                }
                return
            }

            DispatchQueue.main.async {
                self?.initiateCall(token: token, callId: callId, toNumber: toNumber)
            }
        }

        return true
    }

    private func initiateCall(token: String, callId: String, toNumber: String) {
        callState = .connecting

        // Build connect options with call_id parameter
        // This will be passed to our TwiML App webhook
        let connectOptions = ConnectOptions(accessToken: token) { builder in
            builder.params = [
                "call_id": callId,
                "to": toNumber
            ]
        }

        print("[VoipService] Making VoIP call to \(toNumber) with call_id=\(callId)")

        activeCall = TwilioVoiceSDK.connect(options: connectOptions, delegate: self)
    }

    /// Disconnect the active call (user initiated)
    func disconnect() {
        activeCall?.disconnect()
        activeCall = nil
        callState = .disconnected(reason: .cancelled, message: nil)
        resetAudio()
    }

    /// Toggle mute
    func toggleMute() {
        guard let call = activeCall else { return }
        let newMuteState = !isMuted
        call.isMuted = newMuteState
        isMuted = newMuteState
        print("[VoipService] Mute toggled: \(newMuteState)")
    }

    /// Toggle speaker
    func toggleSpeaker() {
        let newSpeakerState = !isSpeakerOn
        do {
            let audioSession = AVAudioSession.sharedInstance()
            if newSpeakerState {
                try audioSession.overrideOutputAudioPort(.speaker)
            } else {
                try audioSession.overrideOutputAudioPort(.none)
            }
            isSpeakerOn = newSpeakerState
            print("[VoipService] Speaker toggled: \(newSpeakerState)")
        } catch {
            print("[VoipService] Failed to toggle speaker: \(error)")
        }
    }

    /// Check if there's an active call
    var hasActiveCall: Bool {
        activeCall != nil
    }

    private func resetAudio() {
        isMuted = false
        isSpeakerOn = false
        do {
            try AVAudioSession.sharedInstance().overrideOutputAudioPort(.none)
        } catch {
            print("[VoipService] Failed to reset audio: \(error)")
        }
    }

    /// Parse the disconnect reason from Twilio error
    private func parseDisconnectReason(_ error: Error?) -> CallEndReason {
        guard let error = error as NSError? else {
            return .completed
        }

        let message = error.localizedDescription.lowercased()
        let code = error.code

        // Twilio error codes
        switch code {
        case 31005: return .declined // Call rejected
        case 31486: return .busy // Busy
        case 31480: return .noAnswer // Timeout/No answer
        case 31487: return .cancelled // Cancelled
        default: break
        }

        // Fall back to message parsing
        if message.contains("rejected") || message.contains("declined") {
            return .declined
        } else if message.contains("busy") {
            return .busy
        } else if message.contains("no answer") || message.contains("timeout") {
            return .noAnswer
        } else if message.contains("cancel") {
            return .cancelled
        } else if message.contains("failed") || message.contains("error") {
            return .failed
        }

        return .unknown
    }
}

// MARK: - CallDelegate

extension VoipService: CallDelegate {
    nonisolated func callDidStartRinging(call: Call) {
        print("[VoipService] Call ringing")
        Task { @MainActor in
            self.callState = .ringing
        }
    }

    nonisolated func callDidConnect(call: Call) {
        print("[VoipService] Call connected")
        Task { @MainActor in
            self.callState = .connected
            // NOTE: do NOT call AVAudioSession.setCategory here. Twilio's
            // DefaultAudioDevice (set in init via TwilioVoiceSDK.audioDevice =
            // DefaultAudioDevice()) owns the audio session for the duration
            // of the call. Re-setting the category mid-call breaks the audio
            // bridge — symptom: recipient cannot hear caller even though
            // Twilio's recording captures both legs (because each leg's audio
            // reaches Twilio's recorders independently but isn't relayed
            // through to the other party). Same bug ScribeAI iOS hit; same
            // fix.
            //
            // To put audio on speaker, use overrideOutputAudioPort only —
            // that route the SDK supports.
            do {
                try AVAudioSession.sharedInstance().overrideOutputAudioPort(.speaker)
                self.isSpeakerOn = true
            } catch {
                print("[VoipService] Failed to default to speaker: \(error)")
            }
        }
    }

    nonisolated func callDidDisconnect(call: Call, error: Error?) {
        print("[VoipService] Call disconnected: \(error?.localizedDescription ?? "no error")")
        Task { @MainActor in
            self.activeCall = nil
            let reason = self.parseDisconnectReason(error)
            self.callState = .disconnected(reason: reason, message: error?.localizedDescription)
            self.resetAudio()

            // Reset audio session
            do {
                try AVAudioSession.sharedInstance().setActive(false)
            } catch {
                print("[VoipService] Failed to deactivate audio session: \(error)")
            }
        }
    }

    nonisolated func callDidFailToConnect(call: Call, error: Error) {
        print("[VoipService] Call failed to connect: \(error.localizedDescription)")
        Task { @MainActor in
            self.activeCall = nil
            self.callState = .failed(error: error.localizedDescription)
            self.resetAudio()
        }
    }

    nonisolated func callDidReceiveQualityWarnings(call: Call, currentWarnings: Set<NSNumber>, previousWarnings: Set<NSNumber>) {
        print("[VoipService] Call quality warnings: \(currentWarnings)")
    }
}
