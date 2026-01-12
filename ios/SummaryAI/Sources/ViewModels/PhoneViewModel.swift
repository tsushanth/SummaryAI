import Foundation
import Combine

// MARK: - Phone View State

/// Represents the loading state for phone operations
enum PhoneViewState: Equatable {
    case idle
    case loading
    case loaded
    case empty
    case error(String)

    var isLoading: Bool {
        self == .loading
    }

    var isError: Bool {
        if case .error = self { return true }
        return false
    }
}

/// Represents the state of phone verification
enum VerificationState: Equatable {
    case idle
    case sendingCode
    case codeSent
    case verifying
    case verified
    case error(String)
}

/// Represents the state of an active call
enum ActiveCallState: Equatable {
    case none
    case initiating
    case ringing
    case connected
    case recording
    case ended
    case error(String)
}

// MARK: - Phone View Model

/// View model for phone feature - handles verification, calls, and call history
@MainActor
final class PhoneViewModel: ObservableObject {

    // MARK: - Published Properties

    /// List of verified phone numbers
    @Published private(set) var verifiedPhones: [VerifiedPhone] = []

    /// List of phone calls
    @Published private(set) var phoneCalls: [PhoneCall] = []

    /// Current list state
    @Published private(set) var state: PhoneViewState = .idle

    /// Verification state
    @Published private(set) var verificationState: VerificationState = .idle

    /// Active call state
    @Published private(set) var activeCallState: ActiveCallState = .none

    /// Currently active call
    @Published private(set) var activeCall: PhoneCall?

    /// Phone number being verified
    @Published var verificationPhoneNumber: String = ""

    /// Verification code entered by user
    @Published var verificationCode: String = ""

    /// Dialer phone number
    @Published var dialerNumber: String = ""

    /// Dialer contact name
    @Published var dialerContactName: String = ""

    /// Selected phone for outbound calls
    @Published var selectedPhone: VerifiedPhone?

    /// Consent dialog state - controlled by ViewModel
    @Published private(set) var showRecordingConsentDialog: Bool = false

    /// Mute state
    @Published private(set) var isMuted: Bool = false

    /// Speaker state
    @Published private(set) var isSpeakerOn: Bool = false

    /// Error message
    @Published var errorMessage: String?
    @Published var showError: Bool = false

    /// Refresh state
    @Published private(set) var isRefreshing: Bool = false

    /// Processing recording state - shown after a call ends while recording is being processed
    @Published private(set) var isProcessingRecording: Bool = false

    // MARK: - Pagination

    private var totalCalls: Int = 0
    private var currentOffset: Int = 0
    private let limit: Int = 50
    @Published private(set) var hasMoreCalls: Bool = true
    private var isLoadingMore: Bool = false

    // MARK: - Dependencies

    private var apiClient: SummaryAIAPIClient
    private var pollingTask: Task<Void, Never>?
    private var voipService: VoipService { VoipService.shared }
    private var voipStateSubscription: AnyCancellable?

    // MARK: - Initialization

    init(apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
        setupVoipStateObservation()
    }

    deinit {
        pollingTask?.cancel()
        voipStateSubscription?.cancel()
    }

    /// Observe VoipService state changes and update local state
    private func setupVoipStateObservation() {
        voipStateSubscription = voipService.$callState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] voipState in
                self?.handleVoipStateChange(voipState)
            }
    }

    /// Handle VoIP state changes from the VoipService
    private func handleVoipStateChange(_ voipState: VoipCallState) {
        switch voipState {
        case .idle:
            // Only reset if we're not in another state
            break
        case .connecting:
            activeCallState = .initiating
        case .ringing:
            activeCallState = .ringing
        case .connected:
            activeCallState = .connected
        case .disconnected(let reason, _):
            activeCallState = .ended

            // Show processing indicator for completed calls
            if reason == .completed {
                isProcessingRecording = true
            }

            // Refresh data after a delay to get recording_id
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                Task {
                    await self.refreshDataAndCheckRecording()
                }
            }

            // Clear after delay
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                self.activeCall = nil
                self.activeCallState = .none
            }
        case .failed(let error):
            activeCallState = .error(error)
            showError("Call failed: \(error)")
        }

        // Sync mute and speaker state from VoipService
        isMuted = voipService.isMuted
        isSpeakerOn = voipService.isSpeakerOn
    }

    /// Update the API client (called when environment is available)
    func updateApiClient(_ apiClient: SummaryAIAPIClient) {
        self.apiClient = apiClient
    }

    // MARK: - Data Loading

    /// Load verified phones and call history
    func loadData() async {
        guard state != .loading else { return }

        state = .loading

        do {
            // Load verified phones
            let phonesResponse = try await apiClient.getVerifiedPhones()
            verifiedPhones = phonesResponse.phones

            // Auto-select first phone if none selected
            if selectedPhone == nil && !verifiedPhones.isEmpty {
                selectedPhone = verifiedPhones.first
            }

            // Load call history
            let callsResponse = try await apiClient.getPhoneCalls(limit: limit, offset: 0)
            phoneCalls = callsResponse.calls
            totalCalls = callsResponse.total
            currentOffset = 0
            hasMoreCalls = callsResponse.calls.count < callsResponse.total

            state = phoneCalls.isEmpty && verifiedPhones.isEmpty ? .empty : .loaded

        } catch {
            handleError(error)
        }
    }

    /// Refresh data (pull-to-refresh)
    func refreshData() async {
        guard !isRefreshing else { return }

        isRefreshing = true

        do {
            let phonesResponse = try await apiClient.getVerifiedPhones()
            verifiedPhones = phonesResponse.phones

            let callsResponse = try await apiClient.getPhoneCalls(limit: limit, offset: 0)
            phoneCalls = callsResponse.calls
            totalCalls = callsResponse.total
            currentOffset = 0
            hasMoreCalls = callsResponse.calls.count < callsResponse.total

            state = phoneCalls.isEmpty && verifiedPhones.isEmpty ? .empty : .loaded

        } catch {
            if let apiError = error as? APIError, apiError.requiresReauth {
                return
            }
            showError(error.localizedDescription)
        }

        isRefreshing = false
    }

    /// Refresh data and check if recording is ready
    /// Keeps polling until recording_id is available or max attempts reached
    func refreshDataAndCheckRecording() async {
        let maxAttempts = 10
        let delaySeconds: UInt64 = 5_000_000_000 // 5 seconds

        for attempt in 1...maxAttempts {
            await refreshData()

            // Check if the most recent completed call has a recording_id
            if let recentCall = phoneCalls.first,
               recentCall.status == .completed,
               recentCall.recordingId != nil {
                // Recording is ready
                isProcessingRecording = false
                return
            }

            // Wait before next attempt (except on last attempt)
            if attempt < maxAttempts {
                try? await Task.sleep(nanoseconds: delaySeconds)
            }
        }

        // Max attempts reached, stop showing processing indicator
        isProcessingRecording = false
    }

    /// Load more calls (pagination)
    func loadMoreCallsIfNeeded(currentCall: PhoneCall) async {
        guard let lastCall = phoneCalls.last,
              lastCall.id == currentCall.id,
              hasMoreCalls,
              !isLoadingMore else {
            return
        }

        isLoadingMore = true
        let nextOffset = currentOffset + limit

        do {
            let response = try await apiClient.getPhoneCalls(limit: limit, offset: nextOffset)
            phoneCalls.append(contentsOf: response.calls)
            currentOffset = nextOffset
            hasMoreCalls = phoneCalls.count < response.total

        } catch {
            print("[PhoneViewModel] Failed to load more calls: \(error)")
        }

        isLoadingMore = false
    }

    // MARK: - Phone Verification

    /// Send verification code to phone number
    func sendVerificationCode() async {
        guard !verificationPhoneNumber.isEmpty else {
            showError("Please enter a phone number")
            return
        }

        verificationState = .sendingCode

        do {
            _ = try await apiClient.sendVerificationCode(phoneNumber: verificationPhoneNumber)
            verificationState = .codeSent

        } catch {
            verificationState = .error(error.localizedDescription)
            showError("Failed to send verification code: \(error.localizedDescription)")
        }
    }

    /// Check verification code
    func checkVerificationCode() async {
        guard !verificationCode.isEmpty else {
            showError("Please enter the verification code")
            return
        }

        verificationState = .verifying

        do {
            let response = try await apiClient.checkVerificationCode(
                phoneNumber: verificationPhoneNumber,
                code: verificationCode
            )

            if response.verified, let phone = response.phone {
                verifiedPhones.append(phone)
                if selectedPhone == nil {
                    selectedPhone = phone
                }
                verificationState = .verified

                // Clear input fields
                verificationPhoneNumber = ""
                verificationCode = ""
            } else {
                verificationState = .error("Invalid verification code")
                showError("Invalid verification code")
            }

        } catch {
            verificationState = .error(error.localizedDescription)
            showError("Verification failed: \(error.localizedDescription)")
        }
    }

    /// Reset verification state
    func resetVerification() {
        verificationState = .idle
        verificationPhoneNumber = ""
        verificationCode = ""
    }

    /// Delete a verified phone
    func deleteVerifiedPhone(_ phone: VerifiedPhone) async {
        do {
            try await apiClient.deleteVerifiedPhone(id: phone.id)
            verifiedPhones.removeAll { $0.id == phone.id }

            if selectedPhone?.id == phone.id {
                selectedPhone = verifiedPhones.first
            }

        } catch {
            showError("Failed to delete phone: \(error.localizedDescription)")
        }
    }

    // MARK: - Consent Dialog Management

    /// Show the recording consent dialog
    func showConsentDialog() {
        showRecordingConsentDialog = true
    }

    /// Dismiss the recording consent dialog
    func dismissConsentDialog() {
        showRecordingConsentDialog = false
    }

    /// Called when user accepts the consent dialog
    func acceptConsentAndCall() async {
        showRecordingConsentDialog = false
        await initiateCall()
    }

    /// Call a number from call history
    func callFromHistory(_ call: PhoneCall) {
        // Pre-fill the dialer with the call's number
        dialerNumber = call.toNumber
        dialerContactName = call.toName ?? ""
        showRecordingConsentDialog = false

        // Automatically initiate the call (bypassing consent since they're redialing a recorded call)
        Task {
            await initiateCall()
        }
    }

    // MARK: - Call Management

    /// Initiate a phone call using VoIP (Twilio Voice SDK)
    func initiateCall() async {
        guard let fromPhone = selectedPhone else {
            showError("Please verify a phone number first")
            return
        }

        guard !dialerNumber.isEmpty else {
            showError("Please enter a phone number to call")
            return
        }

        // Dismiss consent dialog and set call state
        showRecordingConsentDialog = false
        activeCallState = .initiating

        do {
            // Step 1: Create call record on backend (without server_initiated flag)
            let response = try await apiClient.initiateCall(
                from: fromPhone.phoneNumber,
                to: dialerNumber,
                toName: dialerContactName.isEmpty ? nil : dialerContactName
            )

            // Step 2: Get VoIP access token from backend
            let tokenResponse = try await apiClient.getVoipToken()
            voipService.setAccessToken(tokenResponse.token)

            // Fetch the call details
            let callResponse = try await apiClient.getPhoneCall(id: response.callId)
            activeCall = callResponse.call

            // Add to calls list
            phoneCalls.insert(callResponse.call, at: 0)

            let toNumberForCall = dialerNumber

            // Clear dialer
            dialerNumber = ""
            dialerContactName = ""

            // Step 3: Make VoIP call using Twilio Voice SDK
            // This connects directly through the app (like Android)
            let success = voipService.makeCall(callId: response.callId, toNumber: toNumberForCall)
            if !success {
                activeCallState = .error("Failed to connect VoIP call")
                showError("Failed to connect call. Please check microphone permissions.")
                return
            }

            // Start polling for call status (for recording status updates)
            startCallPolling()

        } catch {
            activeCallState = .error(error.localizedDescription)
            showError("Failed to initiate call: \(error.localizedDescription)")
        }
    }

    /// Start recording the active call
    func startRecording() async {
        guard let call = activeCall else { return }

        do {
            let response = try await apiClient.startCallRecording(callId: call.id)

            if response.recording {
                activeCallState = .recording
                // Update local call state
                if var updatedCall = activeCall {
                    updatedCall.isRecording = true
                    activeCall = updatedCall
                    updateCallInList(updatedCall)
                }
            }

        } catch {
            showError("Failed to start recording: \(error.localizedDescription)")
        }
    }

    /// Stop recording the active call
    func stopRecording() async {
        guard let call = activeCall else { return }

        do {
            let response = try await apiClient.stopCallRecording(callId: call.id)

            if !response.recording {
                activeCallState = .connected
                if var updatedCall = activeCall {
                    updatedCall.isRecording = false
                    activeCall = updatedCall
                    updateCallInList(updatedCall)
                }
            }

        } catch {
            showError("Failed to stop recording: \(error.localizedDescription)")
        }
    }

    /// Hang up the active call
    func hangupCall() async {
        // Disconnect VoIP call
        voipService.disconnect()

        // Also notify backend
        if let call = activeCall {
            do {
                _ = try await apiClient.hangupCall(callId: call.id)
            } catch {
                print("[PhoneViewModel] Failed to notify backend of hangup: \(error)")
            }

            if var updatedCall = activeCall {
                updatedCall.status = .completed
                activeCall = updatedCall
                updateCallInList(updatedCall)
            }
        }

        activeCallState = .ended

        // Stop polling
        stopCallPolling()

        // Clear active call after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            self.activeCall = nil
            self.activeCallState = .none
        }
    }

    /// Toggle mute state
    func toggleMute() {
        voipService.toggleMute()
        isMuted = voipService.isMuted
    }

    /// Toggle speaker state
    func toggleSpeaker() {
        voipService.toggleSpeaker()
        isSpeakerOn = voipService.isSpeakerOn
    }

    /// Clear the active call state
    func clearActiveCall() {
        activeCall = nil
        activeCallState = .none
        stopCallPolling()
    }

    // MARK: - Call Polling

    private func startCallPolling() {
        pollingTask?.cancel()

        pollingTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds

                guard !Task.isCancelled, let call = activeCall else { break }

                do {
                    let response = try await apiClient.getPhoneCall(id: call.id)
                    activeCall = response.call
                    updateCallInList(response.call)

                    // Update active call state based on status
                    switch response.call.status {
                    case .ringing:
                        activeCallState = .ringing
                    case .inProgress:
                        if response.call.isRecording {
                            activeCallState = .recording
                        } else {
                            activeCallState = .connected
                        }
                    case .recording:
                        activeCallState = .recording
                    case .completed, .failed, .busy, .noAnswer, .cancelled:
                        activeCallState = .ended
                        stopCallPolling()

                        // Show processing indicator for completed calls (not failed/cancelled)
                        if response.call.status == .completed {
                            isProcessingRecording = true
                        }

                        // Refresh data after a delay to get recording_id
                        // Recording is processed async after call ends
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            Task {
                                await self.refreshDataAndCheckRecording()
                            }
                        }

                        // Clear after delay
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            self.activeCall = nil
                            self.activeCallState = .none
                        }
                    default:
                        break
                    }

                } catch {
                    print("[PhoneViewModel] Polling error: \(error)")
                }
            }
        }
    }

    private func stopCallPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func updateCallInList(_ call: PhoneCall) {
        if let index = phoneCalls.firstIndex(where: { $0.id == call.id }) {
            phoneCalls[index] = call
        }
    }

    // MARK: - Error Handling

    private func handleError(_ error: Error) {
        if let apiError = error as? APIError {
            if case .noAccessToken = apiError {
                state = .idle
                return
            }
            if case .unauthorized = apiError {
                state = .idle
                return
            }
        }

        let message: String
        if let apiError = error as? APIError {
            message = apiError.userMessage
        } else {
            message = error.localizedDescription
        }

        state = .error(message)
        showError(message)
    }

    private func showError(_ message: String) {
        errorMessage = message
        showError = true
    }

    func clearError() {
        errorMessage = nil
        showError = false
        if case .error = state {
            state = .idle
        }
    }

    // MARK: - Helpers

    /// Format a phone number for display
    func formatPhoneNumber(_ phone: String) -> String {
        if phone.hasPrefix("+1") && phone.count == 12 {
            let start = phone.index(phone.startIndex, offsetBy: 2)
            let area = phone[start..<phone.index(start, offsetBy: 3)]
            let prefix = phone[phone.index(start, offsetBy: 3)..<phone.index(start, offsetBy: 6)]
            let line = phone[phone.index(start, offsetBy: 6)...]
            return "(\(area)) \(prefix)-\(line)"
        }
        return phone
    }

    /// Check if user has any verified phones
    var hasVerifiedPhones: Bool {
        !verifiedPhones.isEmpty
    }

    /// Check if there's an active call
    var hasActiveCall: Bool {
        activeCall != nil && activeCallState != .none && activeCallState != .ended
    }
}
