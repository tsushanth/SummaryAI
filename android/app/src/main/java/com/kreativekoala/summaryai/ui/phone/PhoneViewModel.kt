package com.kreativekoala.summaryai.ui.phone

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.PhoneEventRequest
import com.kreativekoala.summaryai.data.api.models.PhoneProfileRequest
import com.kreativekoala.summaryai.data.api.models.PhoneStatusResponse
import com.kreativekoala.summaryai.data.api.models.StartCallRequest
import com.kreativekoala.summaryai.data.repository.PhoneRepository
import com.kreativekoala.summaryai.data.repository.toDomain
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import com.kreativekoala.summaryai.service.CurrentCall
import com.kreativekoala.summaryai.service.VoipCallState
import com.kreativekoala.summaryai.service.VoipService
import com.kreativekoala.summaryai.util.OutputLanguageSource
import com.kreativekoala.summaryai.util.PhoneDevice
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/** A message for the user: our own string, or one that explains a failed request. */
sealed class PhoneMessage {
    data class Resource(@StringRes val res: Int) : PhoneMessage()
    data class Failure(val error: Throwable) : PhoneMessage()
}

enum class PhoneTab { DIALER, CALLS }

sealed class Verification {
    object Hidden : Verification()
    data class Entry(val sending: Boolean = false, val error: PhoneMessage? = null) : Verification()
    /** The app shows [code]; the person types it on the keypad of the call they receive. */
    data class Waiting(val id: String, val code: String, val phoneNumber: String) : Verification()
    object Done : Verification()
    data class Failed(@StringRes val reason: Int) : Verification()
}

/** What the person is asked to accept before every call. */
data class PendingConsent(val to: String, val toName: String?, val from: VerifiedPhone)

/** Where a call stands, from the app's own leg and the server's view of the other one. */
enum class CallStage { CONNECTING, CALLING, RECORDING, ENDED }

data class ActiveCall(val call: CurrentCall, val stage: CallStage, @StringRes val endMessage: Int? = null)

data class PhoneUiState(
    val isLoading: Boolean = true,
    val minutesLeft: Int = 0,
    val minutesPerMonth: Int = 0,
    val serviceAvailable: Boolean = true,
    val maxNumbers: Int = 2,
    val phones: List<VerifiedPhone> = emptyList(),
    val selectedPhoneId: String? = null,
    val calls: List<PhoneCall> = emptyList(),
    val tab: PhoneTab = PhoneTab.DIALER,
    val dialerNumber: String = "",
    val dialerName: String = "",
    val callLanguage: String = "en",
    val callLanguages: List<String> = listOf("en"),
    val verification: Verification = Verification.Hidden,
    val askBusiness: Boolean = false,
    val consent: PendingConsent? = null,
    val starting: Boolean = false,
    val activeCall: ActiveCall? = null,
    val message: PhoneMessage? = null
) {
    val selectedPhone: VerifiedPhone? get() = phones.firstOrNull { it.id == selectedPhoneId } ?: phones.firstOrNull()
}

/** Client-side check of what was typed; the server repeats it and decides. Null when it can be sent. */
@StringRes
fun phoneNumberProblem(input: String): Int? {
    val compact = input.filterNot { it.isWhitespace() || it in "()-." }
    return when {
        compact.isEmpty() -> R.string.error_enter_phone_number
        !compact.startsWith("+") -> R.string.phone_error_country_code
        !compact.matches(Regex("\\+[0-9]{8,15}")) -> R.string.phone_error_invalid_number
        !compact.startsWith("+1") -> R.string.phone_error_country_unsupported
        compact.length != 12 -> R.string.phone_error_invalid_number
        else -> null
    }
}

@StringRes
fun verificationFailureRes(reason: String?): Int = when (reason) {
    "expired" -> R.string.phone_verify_expired
    "code_not_entered" -> R.string.phone_verify_wrong_code
    else -> R.string.phone_error_verify_call_failed
}

/** The language of the recording notice offered first: the app's own when the notice exists in it. */
fun defaultCallLanguage(appLanguage: String, offered: List<String>): String =
    offered.firstOrNull { it == appLanguage.lowercase().substringBefore('-') } ?: "en"

@HiltViewModel
class PhoneViewModel @Inject constructor(
    private val repository: PhoneRepository,
    private val voip: VoipService,
    private val outputLanguage: OutputLanguageSource,
    private val device: PhoneDevice
) : ViewModel() {

    private val _uiState = MutableStateFlow(PhoneUiState())
    val uiState: StateFlow<PhoneUiState> = _uiState.asStateFlow()

    val isMuted: StateFlow<Boolean> = voip.isMuted
    val isSpeakerOn: StateFlow<Boolean> = voip.isSpeakerOn

    private var consentVersion: String? = null
    private var businessAnswered = true
    private var verificationJob: Job? = null
    private var callJob: Job? = null

    init {
        track("tab_opened")
        refresh()
        observeCall()
    }

    private fun track(step: String) {
        viewModelScope.launch { repository.event(PhoneEventRequest(step, device.region, device.isTest.takeIf { it })) }
    }

    fun refresh() {
        viewModelScope.launch {
            repository.status().fold(
                onSuccess = ::applyStatus,
                onFailure = { e -> _uiState.update { it.copy(isLoading = false, message = PhoneMessage.Failure(e)) } }
            )
            repository.calls().onSuccess { calls -> _uiState.update { it.copy(calls = calls) } }
        }
    }

    private fun applyStatus(status: PhoneStatusResponse) {
        consentVersion = status.consentVersion
        businessAnswered = status.businessAnswered ?: true
        val languages = status.callLanguages?.takeIf { it.isNotEmpty() } ?: listOf("en")
        _uiState.update {
            it.copy(
                isLoading = false,
                minutesLeft = status.minutesLeft ?: 0,
                minutesPerMonth = status.minutesPerMonth ?: 0,
                serviceAvailable = status.serviceAvailable ?: false,
                maxNumbers = status.maxVerifiedNumbers ?: 2,
                phones = status.phones.orEmpty().map { p -> p.toDomain() },
                callLanguages = languages,
                callLanguage = if (it.isLoading) defaultCallLanguage(device.language, languages) else it.callLanguage
            )
        }
    }

    fun selectTab(tab: PhoneTab) {
        _uiState.update { it.copy(tab = tab) }
        if (tab == PhoneTab.CALLS) refresh()
    }

    fun selectPhone(id: String) = _uiState.update { it.copy(selectedPhoneId = id) }
    fun setDialerNumber(value: String) = _uiState.update { it.copy(dialerNumber = value.take(20)) }
    fun appendDigit(digit: String) = setDialerNumber(_uiState.value.dialerNumber + digit)
    fun deleteDigit() = _uiState.update { it.copy(dialerNumber = it.dialerNumber.dropLast(1)) }
    fun setDialerName(value: String) = _uiState.update { it.copy(dialerName = value.take(100)) }
    fun setCallLanguage(code: String) = _uiState.update { it.copy(callLanguage = code) }
    fun clearMessage() = _uiState.update { it.copy(message = null) }

    // MARK: - Verification

    fun openVerification() {
        track("number_requested")
        _uiState.update { it.copy(verification = Verification.Entry()) }
    }

    fun closeVerification() {
        verificationJob?.cancel()
        _uiState.update { it.copy(verification = Verification.Hidden) }
    }

    fun startVerification(number: String) {
        phoneNumberProblem(number)?.let { res ->
            _uiState.update { it.copy(verification = Verification.Entry(error = PhoneMessage.Resource(res))) }
            return
        }
        if ((_uiState.value.verification as? Verification.Entry)?.sending == true) return
        _uiState.update { it.copy(verification = Verification.Entry(sending = true)) }
        verificationJob?.cancel()
        verificationJob = viewModelScope.launch {
            repository.startVerification(number).fold(
                onSuccess = { started ->
                    _uiState.update { it.copy(verification = Verification.Waiting(started.verificationId, started.code, started.phoneNumber)) }
                    awaitVerification(started.verificationId, started.expiresInSeconds)
                },
                onFailure = { e -> _uiState.update { it.copy(verification = Verification.Entry(error = PhoneMessage.Failure(e))) } }
            )
        }
    }

    private suspend fun awaitVerification(id: String, expiresInSeconds: Int) {
        // A few checks past the expiry, so the server can say how it ended. A failed check is simply tried again.
        repeat(expiresInSeconds / VERIFY_POLL_SECONDS + 5) {
            delay(VERIFY_POLL_SECONDS * 1000L)
            val answer = repository.verification(id).getOrNull() ?: return@repeat
            when (answer.status) {
                "verified" -> {
                    _uiState.update { it.copy(verification = Verification.Done, askBusiness = !businessAnswered, selectedPhoneId = answer.phone?.id) }
                    refresh()
                    return
                }
                "failed" -> {
                    _uiState.update { it.copy(verification = Verification.Failed(verificationFailureRes(answer.reason))) }
                    return
                }
            }
        }
        _uiState.update { it.copy(verification = Verification.Failed(R.string.phone_verify_expired)) }
    }

    fun removePhone(phone: VerifiedPhone) {
        viewModelScope.launch {
            repository.deleteVerifiedPhone(phone.id).fold(
                onSuccess = { refresh() },
                onFailure = { e -> _uiState.update { it.copy(message = PhoneMessage.Failure(e)) } }
            )
        }
    }

    /** [business] is business, personal or skipped. */
    fun answerBusiness(business: String, type: String?) {
        businessAnswered = true
        _uiState.update { it.copy(askBusiness = false) }
        viewModelScope.launch {
            repository.profile(PhoneProfileRequest(business, type, "number", device.region, device.isTest.takeIf { it }))
        }
    }

    // MARK: - Calling

    /** Asks for consent; nothing is sent to the server before the person accepts. */
    fun requestCall(number: String = _uiState.value.dialerNumber, name: String? = _uiState.value.dialerName) {
        val state = _uiState.value
        if (state.activeCall != null || state.starting) return
        val from = state.selectedPhone
        val problem = when {
            from == null -> R.string.error_verify_phone_first
            !state.serviceAvailable -> R.string.phone_service_used_up
            state.minutesLeft <= 0 -> R.string.phone_error_minutes_used
            else -> phoneNumberProblem(number)
        }
        if (problem != null || from == null) {
            _uiState.update { it.copy(message = PhoneMessage.Resource(problem ?: R.string.error_verify_phone_first)) }
            return
        }
        track("consent_shown")
        _uiState.update { it.copy(consent = PendingConsent(number.trim(), name?.trim()?.ifEmpty { null }, from)) }
    }

    /** Dials a past call again: the number is filled in and the consent screen is shown, as for any call. */
    fun callFromHistory(call: PhoneCall) {
        _uiState.update { it.copy(tab = PhoneTab.DIALER, dialerNumber = call.toNumber, dialerName = call.toName.orEmpty()) }
        requestCall(call.toNumber, call.toName)
    }

    fun declineConsent() {
        track("consent_declined")
        _uiState.update { it.copy(consent = null) }
    }

    /** The microphone permission must already be granted. */
    fun acceptConsent() {
        val consent = _uiState.value.consent ?: return
        val version = consentVersion ?: return
        if (_uiState.value.starting) return
        _uiState.update { it.copy(consent = null, starting = true) }
        viewModelScope.launch {
            val request = StartCallRequest(
                to = consent.to,
                fromId = consent.from.id,
                toName = consent.toName,
                consentVersion = version,
                outputLanguage = outputLanguage.current(),
                callLanguage = _uiState.value.callLanguage
            )
            repository.startCall(request).fold(
                onSuccess = { started ->
                    val call = CurrentCall(started.callId, started.toNumber, consent.toName, started.timeLimitSeconds)
                    _uiState.update { it.copy(starting = false, dialerNumber = "", dialerName = "") }
                    if (!voip.makeCall(call, started.token)) {
                        _uiState.update { it.copy(message = PhoneMessage.Resource(R.string.call_end_failed)) }
                    }
                },
                onFailure = { e ->
                    _uiState.update { it.copy(starting = false, message = PhoneMessage.Failure(e)) }
                    refresh()
                }
            )
        }
    }

    fun microphoneRefused() =
        _uiState.update { it.copy(consent = null, message = PhoneMessage.Resource(R.string.microphone_permission_required)) }

    fun toggleMute() = voip.toggleMute()
    fun toggleSpeaker() = voip.toggleSpeaker()
    fun hangUp() = voip.disconnect()

    private fun observeCall() {
        viewModelScope.launch {
            voip.callState.collect { state ->
                val call = voip.currentCall.value
                if (call == null) {
                    callJob?.cancel()
                    _uiState.update { it.copy(activeCall = null) }
                    return@collect
                }
                when (state) {
                    is VoipCallState.Idle -> _uiState.update { it.copy(activeCall = null) }
                    is VoipCallState.Connecting -> _uiState.update { it.copy(activeCall = ActiveCall(call, CallStage.CONNECTING)) }
                    is VoipCallState.Connected -> {
                        _uiState.update { it.copy(activeCall = ActiveCall(call, CallStage.CALLING)) }
                        followCall(call)
                    }
                    is VoipCallState.Disconnected -> showEnd(call, state.reason.messageRes)
                }
            }
        }
    }

    /** Asks the server whether the other person has answered (and so heard the notice). */
    private fun followCall(call: CurrentCall) {
        callJob?.cancel()
        callJob = viewModelScope.launch {
            while (isActive) {
                delay(CALL_POLL_MS)
                val status = repository.phoneCall(call.callId).getOrNull()?.status ?: continue
                if (status == PhoneCallStatus.RECORDING) {
                    _uiState.update { it.copy(activeCall = ActiveCall(call, CallStage.RECORDING)) }
                    break
                }
            }
        }
    }

    /** Shows how the call ended; the server knows "no answer" and "busy", which the app's own leg does not. */
    private fun showEnd(call: CurrentCall, @StringRes fallback: Int) {
        val answered = _uiState.value.activeCall?.stage == CallStage.RECORDING
        callJob?.cancel()
        callJob = viewModelScope.launch {
            _uiState.update { it.copy(activeCall = ActiveCall(call, CallStage.ENDED, fallback)) }
            var final = fallback
            if (!answered) {
                for (attempt in 1..END_POLLS) {
                    delay(CALL_POLL_MS * 2)
                    val status = repository.phoneCall(call.callId).getOrNull()?.status
                    final = when (status) {
                        PhoneCallStatus.NO_ANSWER -> R.string.status_no_answer
                        PhoneCallStatus.BUSY -> R.string.status_busy
                        PhoneCallStatus.FAILED -> R.string.call_end_failed
                        else -> continue
                    }
                    break
                }
            }
            _uiState.update { it.copy(activeCall = ActiveCall(call, CallStage.ENDED, final)) }
            delay(END_SHOWN_MS)
            if (answered) _uiState.update { it.copy(message = PhoneMessage.Resource(R.string.phone_call_saved_hint)) }
            voip.acknowledgeEnd()
            _uiState.update { it.copy(activeCall = null) }
            refresh()
        }
    }

    private companion object {
        const val VERIFY_POLL_SECONDS = 3
        const val CALL_POLL_MS = 2_000L
        const val END_POLLS = 3
        const val END_SHOWN_MS = 2_500L
    }
}
