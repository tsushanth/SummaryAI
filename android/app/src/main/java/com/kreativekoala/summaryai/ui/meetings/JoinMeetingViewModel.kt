package com.kreativekoala.summaryai.ui.meetings

import android.app.Activity
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.coaching.CoachingPersonaKey
import com.kreativekoala.summaryai.data.repository.CoachingRepository
import com.kreativekoala.summaryai.data.repository.MeetingsRepository
import com.kreativekoala.summaryai.service.BillingManager
import com.kreativekoala.summaryai.ui.coaching.ActiveCoachingSession
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class JoinMeetingUiState(
    val meetingUrl: String = "",
    val botName: String = "",
    val isJoining: Boolean = false,
    val meetingJoined: Boolean = false,
    val joinedMeetingId: String? = null,
    val joinedRecordingId: String? = null,
    val error: String? = null,
    // Coaching state
    val coachingEnabled: Boolean = false,
    val coachingPersona: CoachingPersonaKey = CoachingPersonaKey.SalesDiscovery,
    val coachingCredits: Int = 0,
    val isLoadingCoachingCredits: Boolean = false,
    val coachingError: String? = null
)

@HiltViewModel
class JoinMeetingViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val meetingsRepository: MeetingsRepository,
    private val coachingRepository: CoachingRepository,
    private val activeCoachingSession: ActiveCoachingSession,
    private val billingManager: BillingManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(JoinMeetingUiState())
    val uiState: StateFlow<JoinMeetingUiState> = _uiState.asStateFlow()

    init {
        billingManager.onCoachingSubscriptionPurchased = { productId, purchaseToken ->
            viewModelScope.launch {
                _uiState.value = _uiState.value.copy(isLoadingCoachingCredits = true)
                runCatching { coachingRepository.verifyGooglePlayPurchase(productId, purchaseToken) }
                    .onSuccess { resp ->
                        _uiState.value = _uiState.value.copy(
                            isLoadingCoachingCredits = false,
                            coachingCredits = resp.balance,
                        )
                    }
                    .onFailure { e ->
                        _uiState.value = _uiState.value.copy(
                            isLoadingCoachingCredits = false,
                            coachingError = "Couldn't unlock credits: ${e.message}",
                        )
                    }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        billingManager.onCoachingSubscriptionPurchased = null
    }

    fun updateMeetingUrl(url: String) {
        _uiState.value = _uiState.value.copy(meetingUrl = url)
    }

    fun updateBotName(name: String) {
        _uiState.value = _uiState.value.copy(botName = name)
    }

    fun joinMeeting() {
        val state = _uiState.value
        if (state.meetingUrl.isBlank()) return

        // Normalize URL - add https:// if no protocol specified
        val normalizedUrl = normalizeUrl(state.meetingUrl)

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isJoining = true, error = null)

            val result = meetingsRepository.joinMeeting(
                joinUrl = normalizedUrl,
                botName = state.botName.ifBlank { null }
            )

            result.fold(
                onSuccess = { (meeting, recordingId) ->
                    _uiState.value = _uiState.value.copy(
                        isJoining = false,
                        meetingJoined = true,
                        joinedMeetingId = meeting.id,
                        joinedRecordingId = recordingId
                    )
                    // Auto-start coaching session if requested
                    if (state.coachingEnabled && recordingId != null) {
                        startCoachingSession(meetingId = meeting.id, recordingId = recordingId)
                    }
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isJoining = false,
                        error = error.message ?: context.getString(R.string.error_join_meeting_failed)
                    )
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    // ----- Coaching -----

    /** Idempotent free-tier claim + balance fetch. Call from the screen's launch. */
    fun loadCoachingState() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingCoachingCredits = true)
            runCatching { coachingRepository.claimFreeCredits() }
            val balance = runCatching { coachingRepository.getCredits().balance }.getOrDefault(0)
            _uiState.value = _uiState.value.copy(
                isLoadingCoachingCredits = false,
                coachingCredits = balance
            )
        }
    }

    fun setCoachingEnabled(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(coachingEnabled = enabled)
    }

    fun setCoachingPersona(persona: CoachingPersonaKey) {
        _uiState.value = _uiState.value.copy(coachingPersona = persona)
    }

    fun clearCoachingError() {
        _uiState.value = _uiState.value.copy(coachingError = null)
    }

    /**
     * Launch Play's subscription purchase flow for the coaching IAP. Returns
     * true if the flow was launched. On purchase success the callback above
     * (init block) verifies with the backend + refreshes the credit balance.
     */
    fun purchaseCoachingSubscription(activity: Activity): Boolean {
        val launched = billingManager.purchaseCoachingSubscription(activity)
        if (!launched) {
            _uiState.value = _uiState.value.copy(
                coachingError = "Subscription not available yet — please try again in a moment.",
            )
        }
        return launched
    }

    /** DEBUG builds only: grants 5 credits per call so we can test before real IAPs ship. */
    fun debugGrantCoachingCredits() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingCoachingCredits = true)
            runCatching { coachingRepository.debugGrantCredits() }
                .onSuccess { resp ->
                    _uiState.value = _uiState.value.copy(
                        isLoadingCoachingCredits = false,
                        coachingCredits = resp.balance
                    )
                }
                .onFailure { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoadingCoachingCredits = false,
                        coachingError = "Debug grant failed: ${e.message}"
                    )
                }
        }
    }

    private fun startCoachingSession(meetingId: String, recordingId: String) {
        viewModelScope.launch {
            runCatching {
                coachingRepository.startSession(recordingId, _uiState.value.coachingPersona)
            }.onSuccess { resp ->
                activeCoachingSession.start(meetingId = meetingId, sessionId = resp.sessionId)
            }.onFailure { e ->
                _uiState.value = _uiState.value.copy(
                    coachingError = e.message ?: "Could not start AI Coach."
                )
            }
        }
    }

    /**
     * Normalize the meeting URL by adding https:// if no protocol is specified
     */
    private fun normalizeUrl(url: String): String {
        val trimmed = url.trim()
        return when {
            trimmed.startsWith("https://") || trimmed.startsWith("http://") -> trimmed
            else -> "https://$trimmed"
        }
    }
}
