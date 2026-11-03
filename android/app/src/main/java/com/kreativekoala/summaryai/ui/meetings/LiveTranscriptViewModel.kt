package com.kreativekoala.summaryai.ui.meetings

import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.LanguageCatalog
import com.kreativekoala.summaryai.data.MeetingLanguages
import com.kreativekoala.summaryai.data.local.PreferencesManager
import com.kreativekoala.summaryai.data.repository.LiveLanguageConflict
import com.kreativekoala.summaryai.data.repository.LiveLanguageResult
import com.kreativekoala.summaryai.data.repository.MeetingsRepository
import com.kreativekoala.summaryai.data.repository.TranscriptionLanguagesRepository
import com.kreativekoala.summaryai.domain.model.LiveTranscriptSegment
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LiveTranscriptUiState(
    val segments: List<LiveTranscriptSegment> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = false,
    /** "auto" or a primary subtag. Auto-detect when the backend reports nothing. */
    val activeLanguage: String = MeetingLanguages.AUTO,
    /** False only when the backend says this meeting cannot switch now; unknown (older backend) = true. */
    val canChangeLanguage: Boolean = true,
    /** Backend `live_language.reason`: "not_live" | "provider_fixed" (null when changeable or unknown). */
    val languageBlockedReason: String? = null,
    val languageCatalog: LanguageCatalog = LanguageCatalog.FALLBACK,
    val isChangingLanguage: Boolean = false,
    val languageNotice: LanguageNotice? = null
)

/** One-shot result of a language change; the screen turns it into localized text. */
sealed interface LanguageNotice {
    data class Changed(val language: String) : LanguageNotice
    /** Saved for the final transcript, but the live stream was not switched. */
    data class SavedNotLive(val language: String) : LanguageNotice
    /** HTTP 409 LIVE_LANGUAGE_FIXED */
    data object NotSwitchable : LanguageNotice
    /** HTTP 409 MEETING_NOT_LIVE */
    data object NotLive : LanguageNotice
    data object Failed : LanguageNotice
}

/** What a change attempt leaves on screen. [blockedReason] non-null = the meeting cannot switch (hide the button). */
internal data class LanguageOutcome(
    val language: String,
    val notice: LanguageNotice,
    val blockedReason: String? = null
)

/** Maps the repository outcome to the new active language and the notice to show. */
internal fun applyLiveLanguageResult(
    previousLanguage: String,
    result: LiveLanguageResult
): LanguageOutcome = when (result) {
    is LiveLanguageResult.Success -> {
        val language = MeetingLanguages.normalize(result.language)
        LanguageOutcome(language, if (result.liveApplied) LanguageNotice.Changed(language) else LanguageNotice.SavedNotLive(language))
    }
    is LiveLanguageResult.NotSwitchable -> when (result.conflict) {
        LiveLanguageConflict.FIXED -> LanguageOutcome(previousLanguage, LanguageNotice.NotSwitchable, "provider_fixed")
        LiveLanguageConflict.NOT_LIVE -> LanguageOutcome(previousLanguage, LanguageNotice.NotLive, "not_live")
    }
    is LiveLanguageResult.Failed -> LanguageOutcome(previousLanguage, LanguageNotice.Failed)
}

@HiltViewModel
class LiveTranscriptViewModel @Inject constructor(
    private val meetingsRepository: MeetingsRepository,
    private val preferencesManager: PreferencesManager,
    private val languagesRepository: TranscriptionLanguagesRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(LiveTranscriptUiState())
    val uiState: StateFlow<LiveTranscriptUiState> = _uiState.asStateFlow()

    private var meetingId: String = ""
    private var pollingJob: Job? = null
    private var lastFetchTime: String? = null

    // Speaker color mapping
    private val speakerColorMap = mutableMapOf<String, Int>()
    private var nextColorIndex = 0

    // Speaker colors for visual distinction
    private val speakerColors = listOf(
        Color(0xFF2196F3), // Blue
        Color(0xFF4CAF50), // Green
        Color(0xFF9C27B0), // Purple
        Color(0xFFFF9800), // Orange
        Color(0xFFE91E63), // Pink
        Color(0xFF009688), // Teal
        Color(0xFF3F51B5), // Indigo
        Color(0xFFF44336)  // Red
    )

    /**
     * Update the meeting ID and reset state
     */
    fun updateMeetingId(newMeetingId: String) {
        if (newMeetingId != meetingId && newMeetingId.isNotEmpty()) {
            meetingId = newMeetingId
            reset()
            loadLanguageState(newMeetingId, withCatalog = true)
        }
    }

    /**
     * Language + whether it can be changed, from GET /api/meetings/:id `live_language`. Without it (older
     * backend, or the call failed) fall back to what this device last set and leave the button available.
     */
    private fun loadLanguageState(id: String, withCatalog: Boolean) {
        viewModelScope.launch {
            if (withCatalog) {
                val catalog = languagesRepository.refresh()
                _uiState.value = _uiState.value.copy(languageCatalog = catalog)
            }
            val detail = meetingsRepository.getMeetingLanguageState(id).getOrNull()
            val live = detail?.liveLanguage
            val reported = live?.language ?: detail?.transcriptionLanguage
            val language = reported ?: preferencesManager.lastMeetingLanguageFor(id).first()
            if (id != meetingId || _uiState.value.isChangingLanguage) return@launch
            val canChange = live?.canChange ?: true
            _uiState.value = _uiState.value.copy(
                activeLanguage = if (language != null) MeetingLanguages.normalize(language) else _uiState.value.activeLanguage,
                canChangeLanguage = canChange,
                languageBlockedReason = if (canChange) null else (live?.reason ?: "provider_fixed")
            )
        }
    }

    fun changeLanguage(code: String) {
        val id = meetingId
        if (id.isEmpty() || _uiState.value.isChangingLanguage) return
        val requested = MeetingLanguages.normalize(code)
        if (requested == _uiState.value.activeLanguage) return
        _uiState.value = _uiState.value.copy(isChangingLanguage = true, languageNotice = null)
        viewModelScope.launch {
            val result = meetingsRepository.setLiveLanguage(id, requested)
            if (result is LiveLanguageResult.Success) {
                preferencesManager.setLastMeetingLanguage(id, result.language)
            }
            if (id != meetingId) return@launch
            val outcome = applyLiveLanguageResult(_uiState.value.activeLanguage, result)
            _uiState.value = _uiState.value.copy(
                activeLanguage = outcome.language,
                canChangeLanguage = if (outcome.blockedReason != null) false else _uiState.value.canChangeLanguage,
                languageBlockedReason = outcome.blockedReason ?: _uiState.value.languageBlockedReason,
                isChangingLanguage = false,
                languageNotice = outcome.notice
            )
        }
    }

    fun clearLanguageNotice() {
        _uiState.value = _uiState.value.copy(languageNotice = null)
    }

    /**
     * Start polling for live transcript updates
     */
    fun startPolling() {
        pollingJob?.cancel()

        pollingJob = viewModelScope.launch {
            // Initial fetch
            fetchTranscript()

            // Poll every 2 seconds; re-check whether the language can be changed every ~30 s
            // (the bot may join after the screen opens, and a failed first check should recover).
            var ticks = 0
            while (true) {
                delay(2000)
                fetchTranscript()
                if (++ticks % 15 == 0 && meetingId.isNotEmpty()) loadLanguageState(meetingId, withCatalog = false)
            }
        }
    }

    /**
     * Stop polling
     */
    fun stopPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    /**
     * Clear all segments and reset state
     */
    fun reset() {
        _uiState.value = LiveTranscriptUiState()
        lastFetchTime = null
        speakerColorMap.clear()
        nextColorIndex = 0
    }

    private suspend fun fetchTranscript() {
        if (meetingId.isEmpty()) return

        meetingsRepository.getLiveTranscript(meetingId, lastFetchTime).fold(
            onSuccess = { (newSegments, hasMore) ->
                // Filter out duplicates
                val existingIds = _uiState.value.segments.map { it.id }.toSet()
                val uniqueNewSegments = newSegments.filter { it.id !in existingIds }

                if (uniqueNewSegments.isNotEmpty()) {
                    // Update last fetch time
                    uniqueNewSegments.lastOrNull()?.let {
                        lastFetchTime = it.createdAt
                    }

                    // Append and sort by timestamp
                    val allSegments = (_uiState.value.segments + uniqueNewSegments)
                        .sortedBy { it.startTimestamp }

                    _uiState.value = _uiState.value.copy(
                        segments = allSegments,
                        hasMore = hasMore,
                        error = null
                    )
                }
            },
            onFailure = { error ->
                // Don't show error for normal polling failures
                // Just log it
                android.util.Log.d("LiveTranscript", "Fetch error: ${error.message}")
            }
        )
    }

    /**
     * Get a consistent color index for a speaker
     */
    fun getColorIndex(speakerId: String?): Int {
        if (speakerId == null) return 0

        return speakerColorMap.getOrPut(speakerId) {
            val index = nextColorIndex
            nextColorIndex++
            index
        }
    }

    /**
     * Get the color for a speaker
     */
    fun getSpeakerColor(speakerId: String?): Color {
        val index = getColorIndex(speakerId)
        return speakerColors[index % speakerColors.size]
    }

    /**
     * Format timestamp as mm:ss
     */
    fun formatTimestamp(seconds: Double): String {
        val mins = (seconds / 60).toInt()
        val secs = (seconds % 60).toInt()
        return String.format("%d:%02d", mins, secs)
    }

    override fun onCleared() {
        super.onCleared()
        stopPolling()
    }
}
