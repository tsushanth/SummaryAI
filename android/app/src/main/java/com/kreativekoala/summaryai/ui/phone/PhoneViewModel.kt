package com.kreativekoala.summaryai.ui.phone

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.PhoneEventRequest
import com.kreativekoala.summaryai.data.api.models.PhoneProfileRequest
import com.kreativekoala.summaryai.data.api.models.PhoneStatusResponse
import com.kreativekoala.summaryai.data.api.models.StartCallRequest
import com.kreativekoala.summaryai.data.repository.PhoneSource
import com.kreativekoala.summaryai.data.repository.toDomain
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import com.kreativekoala.summaryai.service.CurrentCall
import com.kreativekoala.summaryai.service.MoreMinutesMemory
import com.kreativekoala.summaryai.service.VoipCallState
import com.kreativekoala.summaryai.service.VoipService
import com.kreativekoala.summaryai.util.ApiErrors
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

enum class PhoneTab { DIALER, CALLS, NUMBER }

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

/** With this many free minutes or fewer, the person is asked whether they would like more. */
const val LOW_MINUTES = 5

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
    val message: PhoneMessage? = null,
    /** The server shows the own-number screen to this account. */
    val ownNumberAvailable: Boolean = false,
    /** The account's own number, which calls can show instead of a verified one. */
    val ownNumber: VerifiedPhone? = null,
    val openCall: PhoneCall? = null,
    /** Whether the server offers anything to buy; null until it has said. */
    val purchaseOffered: Boolean? = null,
    /** This account asked for more minutes this month, on this device. */
    val moreMinutesAsked: Boolean = false,
    val sendingMoreMinutes: Boolean = false,
    /** A call was tried with no free minutes left. */
    val noMinutesDialog: Boolean = false
) {
    /** Few or no free minutes and nothing to buy: the card that asks about more minutes. */
    val showMoreMinutes: Boolean
        get() = serviceAvailable && purchaseOffered == false && minutesLeft <= LOW_MINUTES

    /** Calls need a verified number; the own number can then be chosen as the one shown. */
    val selectedPhone: VerifiedPhone?
        get() = phones.firstOrNull { it.id == selectedPhoneId }
            ?: ownNumber?.takeIf { it.id == selectedPhoneId && phones.isNotEmpty() }
            ?: phones.firstOrNull()
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
    private val repository: PhoneSource,
    private val voip: VoipService,
    private val outputLanguage: OutputLanguageSource,
    private val device: PhoneDevice,
    private val moreMinutes: MoreMinutesMemory
) : ViewModel() {

    private val _uiState = MutableStateFlow(PhoneUiState())
    val uiState: StateFlow<PhoneUiState> = _uiState.asStateFlow()

    val isMuted: StateFlow<Boolean> = voip.isMuted
    val isSpeakerOn: StateFlow<Boolean> = voip.isSpeakerOn

    private var consentVersion: String? = null
    private var businessAnswered = true
    private var businessContext = "number"
    private var verificationJob: Job? = null
    private var callJob: Job? = null
    private var moreMinutesCardCounted = false

    init {
        track("tab_opened")
        refresh()
        observeCall()
    }

    private fun step(name: String) = PhoneEventRequest(name, device.region, device.isTest.takeIf { it })

    private fun track(name: String) {
        viewModelScope.launch { repository.event(step(name)) }
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
                ownNumberAvailable = status.ownNumber == true,
                purchaseOffered = status.purchaseOffered,
                moreMinutesAsked = moreMinutes.askedThisMonth(),
                tab = if (it.tab == PhoneTab.NUMBER && status.ownNumber != true) PhoneTab.DIALER else it.tab,
                callLanguages = languages,
                callLanguage = if (it.isLoading) defaultCallLanguage(device.language, languages) else it.callLanguage
            )
        }
        countMoreMinutesCard()
    }

    fun selectTab(tab: PhoneTab) {
        _uiState.update { it.copy(tab = tab) }
        if (tab == PhoneTab.CALLS) refresh()
        countMoreMinutesCard()
    }

    fun selectPhone(id: String) = _uiState.update { it.copy(selectedPhoneId = id) }
    fun setOwnNumber(number: VerifiedPhone?) = _uiState.update { it.copy(ownNumber = number) }

    // MARK: - Results

    fun openCall(call: PhoneCall) {
        track("call_result_opened")
        _uiState.update { it.copy(openCall = call) }
    }

    fun closeCall() = _uiState.update { it.copy(openCall = null) }

    /** Asked once, also when somebody sets up an agent without having answered it for a number. */
    fun askBusinessForAgent() {
        if (businessAnswered || _uiState.value.askBusiness) return
        businessContext = "agent"
        _uiState.update { it.copy(askBusiness = true) }
    }
    fun setDialerNumber(value: String) = _uiState.update { it.copy(dialerNumber = value.take(20)) }
    fun appendDigit(digit: String) = setDialerNumber(_uiState.value.dialerNumber + digit)
    fun deleteDigit() = _uiState.update { it.copy(dialerNumber = it.dialerNumber.dropLast(1)) }
    fun setDialerName(value: String) = _uiState.update { it.copy(dialerName = value.take(100)) }
    fun setCallLanguage(code: String) = _uiState.update { it.copy(callLanguage = code) }
    fun clearMessage() = _uiState.update { it.copy(message = null) }

    // MARK: - More minutes

    /** Counted once a visit, when the card and its button first come into view. */
    private fun countMoreMinutesCard() {
        val state = _uiState.value
        if (moreMinutesCardCounted || state.tab != PhoneTab.DIALER || !state.showMoreMinutes || state.moreMinutesAsked) return
        moreMinutesCardCounted = true
        track("more_minutes_shown")
    }

    /** What a call with no free minutes shows instead of an error. Counted each time it asks. */
    private fun openNoMinutes() {
        if (_uiState.value.noMinutesDialog) return
        val asked = moreMinutes.askedThisMonth()
        _uiState.update { it.copy(noMinutesDialog = true, moreMinutesAsked = asked) }
        if (!asked) track("more_minutes_shown")
    }

    fun closeNoMinutes() = _uiState.update { it.copy(noMinutesDialog = false) }

    /** Thanked, and remembered for the month, only once the server has it. */
    fun askForMoreMinutes() {
        val state = _uiState.value
        if (state.sendingMoreMinutes || state.moreMinutesAsked) return
        _uiState.update { it.copy(sendingMoreMinutes = true) }
        viewModelScope.launch {
            repository.confirmedEvent(step("more_minutes_interest")).fold(
                onSuccess = {
                    moreMinutes.remember()
                    _uiState.update { it.copy(sendingMoreMinutes = false, moreMinutesAsked = true) }
                },
                onFailure = { e ->
                    // The dialog is closed so the reason can be read; the button is there again next time.
                    _uiState.update { it.copy(sendingMoreMinutes = false, noMinutesDialog = false, message = PhoneMessage.Failure(e)) }
                }
            )
        }
    }

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
            repository.profile(PhoneProfileRequest(business, type, businessContext, device.region, device.isTest.takeIf { it }))
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
        if (problem == R.string.phone_error_minutes_used && state.purchaseOffered == false) {
            openNoMinutes()
            return
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
        _uiState.update { it.copy(tab = PhoneTab.DIALER, dialerNumber = call.toNumber, dialerName = call.toName.orEmpty(), openCall = null) }
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
                    // The server can find no minutes left when the screen still showed some.
                    val noMinutes = ApiErrors.parse(e).code == "PHONE_MINUTES_USED" && _uiState.value.purchaseOffered == false
                    _uiState.update { it.copy(starting = false, message = if (noMinutes) it.message else PhoneMessage.Failure(e)) }
                    if (noMinutes) openNoMinutes()
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
