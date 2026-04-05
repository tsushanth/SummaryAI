package com.kreativekoala.summaryai.ui.phone

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.repository.PhoneRepository
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import com.kreativekoala.summaryai.service.CallEndReason
import com.kreativekoala.summaryai.service.VoipCallState
import com.kreativekoala.summaryai.service.VoipService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Phone tab segment
 */
enum class PhoneTab {
    CALLS,
    DIALER,
    SETTINGS
}

/**
 * Verification state
 */
enum class VerificationState {
    IDLE,
    SENDING_CODE,
    CODE_SENT,
    VERIFYING,
    VERIFIED,
    ERROR
}

/**
 * Active call state
 */
enum class ActiveCallState {
    NONE,
    INITIATING,
    RINGING,
    CONNECTED,
    RECORDING,
    ENDED,
    DECLINED,
    BUSY,
    NO_ANSWER,
    ERROR
}

/**
 * UI State for Phone screen
 */
data class PhoneUiState(
    val verifiedPhones: List<VerifiedPhone> = emptyList(),
    val phoneCalls: List<PhoneCall> = emptyList(),
    val selectedPhone: VerifiedPhone? = null,
    val selectedTab: PhoneTab = PhoneTab.CALLS,

    // Loading states
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val hasMoreCalls: Boolean = true,

    // Verification
    val verificationState: VerificationState = VerificationState.IDLE,
    val verificationPhoneNumber: String = "",
    val verificationCode: String = "",
    val verificationError: String? = null,

    // Dialer
    val dialerNumber: String = "",
    val dialerContactName: String = "",

    // Consent dialog - controlled by ViewModel to handle history calls properly
    val showRecordingConsentDialog: Boolean = false,

    // Active call
    val activeCallState: ActiveCallState = ActiveCallState.NONE,
    val activeCall: PhoneCall? = null,

    // Error
    val error: String? = null
) {
    val hasVerifiedPhones: Boolean get() = verifiedPhones.isNotEmpty()
    val hasActiveCall: Boolean get() = activeCall != null && activeCallState != ActiveCallState.NONE && activeCallState != ActiveCallState.ENDED
}

@HiltViewModel
class PhoneViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val phoneRepository: PhoneRepository,
    private val voipService: VoipService
) : ViewModel() {

    private val _uiState = MutableStateFlow(PhoneUiState())
    val uiState: StateFlow<PhoneUiState> = _uiState.asStateFlow()

    // VoIP state
    val voipCallState: StateFlow<VoipCallState> = voipService.callState
    val isMuted: StateFlow<Boolean> = voipService.isMuted
    val isSpeakerOn: StateFlow<Boolean> = voipService.isSpeakerOn

    private var pollingJob: Job? = null
    private var voipStateJob: Job? = null
    private var currentOffset = 0
    private val limit = 50
    private var currentCallId: String? = null

    init {
        loadData()
        observeVoipState()
    }

    /**
     * Observe VoIP call state changes
     */
    private fun observeVoipState() {
        voipStateJob = viewModelScope.launch {
            voipService.callState.collect { state ->
                val newActiveCallState = when (state) {
                    is VoipCallState.Idle -> ActiveCallState.NONE
                    is VoipCallState.Connecting -> ActiveCallState.INITIATING
                    is VoipCallState.Ringing -> ActiveCallState.RINGING
                    is VoipCallState.Connected -> ActiveCallState.RECORDING // Auto-recording
                    is VoipCallState.Disconnected -> {
                        // Map disconnect reason to specific UI state
                        when (state.reason) {
                            CallEndReason.DECLINED -> ActiveCallState.DECLINED
                            CallEndReason.BUSY -> ActiveCallState.BUSY
                            CallEndReason.NO_ANSWER -> ActiveCallState.NO_ANSWER
                            CallEndReason.COMPLETED -> ActiveCallState.ENDED
                            CallEndReason.CANCELLED -> ActiveCallState.ENDED
                            CallEndReason.FAILED -> ActiveCallState.ERROR
                            CallEndReason.UNKNOWN -> ActiveCallState.ENDED
                        }
                    }
                    is VoipCallState.Failed -> ActiveCallState.ERROR
                }

                _uiState.value = _uiState.value.copy(activeCallState = newActiveCallState)

                // Handle call ended - show appropriate message
                if (state is VoipCallState.Disconnected) {
                    val message = state.reason.displayMessage
                    if (state.reason != CallEndReason.COMPLETED && state.reason != CallEndReason.CANCELLED) {
                        // Only show error for actual problems (not normal hang up)
                        _uiState.value = _uiState.value.copy(error = message)
                    }
                    kotlinx.coroutines.delay(3000) // Show state longer for declined/busy/no-answer
                    clearActiveCall()
                }

                // Handle errors
                if (state is VoipCallState.Failed) {
                    _uiState.value = _uiState.value.copy(error = state.error)
                    kotlinx.coroutines.delay(2000)
                    clearActiveCall()
                }
            }
        }
    }

    // MARK: - Tab Navigation

    fun selectTab(tab: PhoneTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    // MARK: - Data Loading

    fun loadData() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            // Load verified phones
            phoneRepository.getVerifiedPhones().fold(
                onSuccess = { phones ->
                    val selected = _uiState.value.selectedPhone ?: phones.firstOrNull()
                    _uiState.value = _uiState.value.copy(
                        verifiedPhones = phones,
                        selectedPhone = selected
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(error = context.getString(R.string.error_load_phones_failed))
                }
            )

            // Load phone calls
            currentOffset = 0
            phoneRepository.getPhoneCalls(limit = limit, offset = 0).fold(
                onSuccess = { result ->
                    _uiState.value = _uiState.value.copy(
                        phoneCalls = result.calls,
                        hasMoreCalls = result.hasMore,
                        isLoading = false
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = context.getString(R.string.error_load_calls_failed)
                    )
                }
            )
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isRefreshing = true)

            phoneRepository.getVerifiedPhones().onSuccess { phones ->
                _uiState.value = _uiState.value.copy(verifiedPhones = phones)
            }

            currentOffset = 0
            phoneRepository.getPhoneCalls(limit = limit, offset = 0).fold(
                onSuccess = { result ->
                    _uiState.value = _uiState.value.copy(
                        phoneCalls = result.calls,
                        hasMoreCalls = result.hasMore,
                        isRefreshing = false
                    )
                },
                onFailure = {
                    _uiState.value = _uiState.value.copy(isRefreshing = false)
                }
            )
        }
    }

    fun loadMoreCalls() {
        if (_uiState.value.isLoading || !_uiState.value.hasMoreCalls) return

        viewModelScope.launch {
            val nextOffset = currentOffset + limit
            phoneRepository.getPhoneCalls(limit = limit, offset = nextOffset).onSuccess { result ->
                currentOffset = nextOffset
                _uiState.value = _uiState.value.copy(
                    phoneCalls = _uiState.value.phoneCalls + result.calls,
                    hasMoreCalls = result.hasMore
                )
            }
        }
    }

    // MARK: - Phone Selection

    fun selectPhone(phone: VerifiedPhone) {
        _uiState.value = _uiState.value.copy(selectedPhone = phone)
    }

    // MARK: - Phone Verification

    fun updateVerificationPhoneNumber(number: String) {
        _uiState.value = _uiState.value.copy(verificationPhoneNumber = number)
    }

    fun updateVerificationCode(code: String) {
        _uiState.value = _uiState.value.copy(verificationCode = code)
    }

    fun sendVerificationCode() {
        val phoneNumber = _uiState.value.verificationPhoneNumber
        if (phoneNumber.isBlank()) {
            _uiState.value = _uiState.value.copy(error = context.getString(R.string.error_enter_phone_number))
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(verificationState = VerificationState.SENDING_CODE)

            phoneRepository.sendVerificationCode(phoneNumber).fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(verificationState = VerificationState.CODE_SENT)
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        verificationState = VerificationState.ERROR,
                        verificationError = error.message
                    )
                }
            )
        }
    }

    fun checkVerificationCode() {
        val code = _uiState.value.verificationCode
        if (code.length != 6) {
            _uiState.value = _uiState.value.copy(error = context.getString(R.string.error_enter_six_digit_code))
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(verificationState = VerificationState.VERIFYING)

            phoneRepository.checkVerificationCode(
                _uiState.value.verificationPhoneNumber,
                code
            ).fold(
                onSuccess = { phone ->
                    if (phone != null) {
                        val phones = _uiState.value.verifiedPhones + phone
                        _uiState.value = _uiState.value.copy(
                            verifiedPhones = phones,
                            selectedPhone = _uiState.value.selectedPhone ?: phone,
                            verificationState = VerificationState.VERIFIED,
                            verificationPhoneNumber = "",
                            verificationCode = ""
                        )
                    } else {
                        _uiState.value = _uiState.value.copy(
                            verificationState = VerificationState.ERROR,
                            verificationError = context.getString(R.string.error_invalid_verification_code)
                        )
                    }
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        verificationState = VerificationState.ERROR,
                        verificationError = error.message
                    )
                }
            )
        }
    }

    fun resetVerification() {
        _uiState.value = _uiState.value.copy(
            verificationState = VerificationState.IDLE,
            verificationPhoneNumber = "",
            verificationCode = "",
            verificationError = null
        )
    }

    fun deleteVerifiedPhone(phone: VerifiedPhone) {
        viewModelScope.launch {
            phoneRepository.deleteVerifiedPhone(phone.id).onSuccess {
                val phones = _uiState.value.verifiedPhones.filter { it.id != phone.id }
                val selected = if (_uiState.value.selectedPhone?.id == phone.id) {
                    phones.firstOrNull()
                } else {
                    _uiState.value.selectedPhone
                }
                _uiState.value = _uiState.value.copy(
                    verifiedPhones = phones,
                    selectedPhone = selected
                )
            }
        }
    }

    // MARK: - Dialer

    fun updateDialerNumber(number: String) {
        _uiState.value = _uiState.value.copy(dialerNumber = number)
    }

    fun updateDialerContactName(name: String) {
        _uiState.value = _uiState.value.copy(dialerContactName = name)
    }

    fun appendDialerDigit(digit: String) {
        _uiState.value = _uiState.value.copy(
            dialerNumber = _uiState.value.dialerNumber + digit
        )
    }

    fun deleteDialerDigit() {
        val current = _uiState.value.dialerNumber
        if (current.isNotEmpty()) {
            _uiState.value = _uiState.value.copy(dialerNumber = current.dropLast(1))
        }
    }

    /**
     * Show the recording consent dialog
     */
    fun showConsentDialog() {
        _uiState.value = _uiState.value.copy(showRecordingConsentDialog = true)
    }

    /**
     * Dismiss the recording consent dialog
     */
    fun dismissConsentDialog() {
        _uiState.value = _uiState.value.copy(showRecordingConsentDialog = false)
    }

    /**
     * Called when user accepts the consent dialog
     */
    fun acceptConsentAndCall() {
        _uiState.value = _uiState.value.copy(showRecordingConsentDialog = false)
        initiateCall()
    }

    /**
     * Call a number from call history
     */
    fun callFromHistory(call: PhoneCall) {
        // Switch to dialer tab and pre-fill the number
        // Note: We call initiateCall directly, bypassing the consent dialog
        // since user is explicitly choosing to redial a recorded call
        _uiState.value = _uiState.value.copy(
            selectedTab = PhoneTab.DIALER,
            dialerNumber = call.toNumber,
            dialerContactName = call.toName ?: "",
            showRecordingConsentDialog = false // Ensure dialog is hidden
        )
        // Automatically initiate the call
        initiateCall()
    }

    // MARK: - Call Management

    /**
     * Initiates a VoIP call with automatic recording.
     * The call goes directly through the app - no phone callback needed.
     * The recipient will hear a recording warning before being connected.
     */
    fun initiateCall() {
        val selectedPhone = _uiState.value.selectedPhone
        if (selectedPhone == null) {
            _uiState.value = _uiState.value.copy(error = context.getString(R.string.error_verify_phone_first))
            return
        }

        val dialerNumber = _uiState.value.dialerNumber
        if (dialerNumber.isBlank()) {
            _uiState.value = _uiState.value.copy(error = context.getString(R.string.error_enter_number_to_call))
            return
        }

        viewModelScope.launch {
            // Dismiss consent dialog and set call state to initiating
            _uiState.value = _uiState.value.copy(
                activeCallState = ActiveCallState.INITIATING,
                showRecordingConsentDialog = false // Always dismiss consent dialog when call starts
            )

            // Step 1: Get VoIP access token
            val tokenResult = phoneRepository.getVoipToken()
            if (tokenResult.isFailure) {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ERROR,
                    error = context.getString(R.string.error_voip_token_failed)
                )
                return@launch
            }

            val token = tokenResult.getOrNull()!!
            voipService.setAccessToken(token)

            // Step 2: Create call record on backend
            val callResult = phoneRepository.createCall(
                fromNumber = selectedPhone.phoneNumber,
                toNumber = dialerNumber,
                toName = _uiState.value.dialerContactName.ifBlank { null }
            )

            if (callResult.isFailure) {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ERROR,
                    error = context.getString(R.string.error_create_call_failed)
                )
                return@launch
            }

            val callDetails = callResult.getOrNull()!!
            currentCallId = callDetails.callId

            // Step 3: Fetch call details for UI
            phoneRepository.getPhoneCall(callDetails.callId).onSuccess { call ->
                _uiState.value = _uiState.value.copy(
                    activeCall = call,
                    phoneCalls = listOf(call) + _uiState.value.phoneCalls,
                    dialerNumber = "",
                    dialerContactName = ""
                )
            }

            // Step 4: Initiate VoIP call via Twilio SDK
            val success = voipService.makeCall(callDetails.callId, callDetails.toNumber)
            if (!success) {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ERROR,
                    error = context.getString(R.string.error_start_voip_call)
                )
                return@launch
            }

            // Start polling for call status updates from backend
            startCallPolling(callDetails.callId)
        }
    }

    /**
     * Toggle mute on the active VoIP call
     */
    fun toggleMute() {
        voipService.toggleMute()
    }

    /**
     * Toggle speaker on the active VoIP call
     */
    fun toggleSpeaker() {
        voipService.toggleSpeaker()
    }

    // Deprecated - recording is automatic
    @Deprecated("Recording is automatic")
    fun startRecording() {
        // Recording is now automatic - this is a no-op
    }

    @Deprecated("Recording is automatic")
    fun stopRecording() {
        // Recording is now automatic - this is a no-op
    }

    fun hangupCall() {
        // Disconnect VoIP call
        voipService.disconnect()

        val call = _uiState.value.activeCall ?: return

        viewModelScope.launch {
            // Also notify backend
            phoneRepository.hangupCall(call.id).onSuccess {
                _uiState.value = _uiState.value.copy(
                    activeCallState = ActiveCallState.ENDED,
                    activeCall = call.copy(status = PhoneCallStatus.COMPLETED)
                )
                stopCallPolling()

                // Clear active call after delay
                viewModelScope.launch {
                    kotlinx.coroutines.delay(2000)
                    _uiState.value = _uiState.value.copy(
                        activeCall = null,
                        activeCallState = ActiveCallState.NONE
                    )
                }
            }
        }
    }

    fun clearActiveCall() {
        voipService.disconnect()
        stopCallPolling()
        currentCallId = null
        _uiState.value = _uiState.value.copy(
            activeCall = null,
            activeCallState = ActiveCallState.NONE
        )
    }

    // MARK: - Call Polling

    private fun startCallPolling(callId: String) {
        pollingJob?.cancel()
        pollingJob = viewModelScope.launch {
            phoneRepository.pollCallStatus(callId).collect { call ->
                _uiState.value = _uiState.value.copy(activeCall = call)
                updateCallInList(call)

                // Update call state based on status
                // Note: IN_PROGRESS is treated as RECORDING since recording is automatic
                val newState = when (call.status) {
                    PhoneCallStatus.RINGING -> ActiveCallState.RINGING
                    PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> ActiveCallState.RECORDING
                    PhoneCallStatus.COMPLETED, PhoneCallStatus.FAILED,
                    PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER,
                    PhoneCallStatus.CANCELLED -> ActiveCallState.ENDED
                    else -> _uiState.value.activeCallState
                }

                _uiState.value = _uiState.value.copy(activeCallState = newState)

                if (newState == ActiveCallState.ENDED) {
                    kotlinx.coroutines.delay(2000)
                    _uiState.value = _uiState.value.copy(
                        activeCall = null,
                        activeCallState = ActiveCallState.NONE
                    )
                }
            }
        }
    }

    private fun stopCallPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    private fun updateCallInList(call: PhoneCall) {
        val calls = _uiState.value.phoneCalls.map {
            if (it.id == call.id) call else it
        }
        _uiState.value = _uiState.value.copy(phoneCalls = calls)
    }

    // MARK: - Error Handling

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        voipService.disconnect()
        stopCallPolling()
        voipStateJob?.cancel()
    }
}
