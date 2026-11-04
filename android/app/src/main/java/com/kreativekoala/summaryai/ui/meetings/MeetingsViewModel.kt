package com.kreativekoala.summaryai.ui.meetings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.LanguageCatalog
import com.kreativekoala.summaryai.data.MeetingLanguages
import com.kreativekoala.summaryai.data.repository.CalendarRepository
import com.kreativekoala.summaryai.data.repository.MeetingsRepository
import com.kreativekoala.summaryai.data.repository.TranscriptionLanguagesRepository
import com.kreativekoala.summaryai.domain.model.CalendarConnection
import com.kreativekoala.summaryai.domain.model.Meeting
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MeetingsUiState(
    val upcomingMeetings: List<Meeting> = emptyList(),
    val pastMeetings: List<Meeting> = emptyList(),
    val calendarConnections: List<CalendarConnection> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val hasCalendarConnected: Boolean = false,
    val languageCatalog: LanguageCatalog = LanguageCatalog.FALLBACK
)

@HiltViewModel
class MeetingsViewModel @Inject constructor(
    private val meetingsRepository: MeetingsRepository,
    private val calendarRepository: CalendarRepository,
    private val languagesRepository: TranscriptionLanguagesRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(MeetingsUiState())
    val uiState: StateFlow<MeetingsUiState> = _uiState.asStateFlow()

    init {
        loadData()
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(languageCatalog = languagesRepository.refresh())
        }
    }

    fun refresh() {
        loadData(triggerSync = true)
    }

    private fun loadData(triggerSync: Boolean = false) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            // Load calendar connections first
            var hasCalendar = false
            val connectionsResult = calendarRepository.getConnections()
            connectionsResult.onSuccess { connections ->
                hasCalendar = connections.any { it.syncEnabled }
                _uiState.value = _uiState.value.copy(
                    calendarConnections = connections,
                    hasCalendarConnected = hasCalendar
                )
            }

            // Trigger calendar sync if requested and we have calendar connections
            // Wait for sync to complete before fetching meetings
            if (triggerSync && hasCalendar) {
                calendarRepository.syncCalendar()
            }

            // Load meetings (after sync completes if triggered)
            val upcomingResult = meetingsRepository.getUpcomingMeetings()
            upcomingResult.fold(
                onSuccess = { meetings ->
                    _uiState.value = _uiState.value.copy(
                        upcomingMeetings = meetings,
                        isLoading = false,
                        error = null
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = error.message
                    )
                }
            )
        }
    }

    fun toggleAutoJoin(meeting: Meeting) {
        viewModelScope.launch {
            val newAutoJoin = !meeting.autoJoin

            // Optimistically update UI
            val updatedMeetings = _uiState.value.upcomingMeetings.map {
                if (it.id == meeting.id) it.copy(autoJoin = newAutoJoin) else it
            }
            _uiState.value = _uiState.value.copy(upcomingMeetings = updatedMeetings)

            // Call API
            meetingsRepository.updateMeeting(meeting.id, autoJoin = newAutoJoin).fold(
                onSuccess = { updatedMeeting ->
                    // Update with server response
                    val serverUpdatedMeetings = _uiState.value.upcomingMeetings.map {
                        if (it.id == meeting.id) updatedMeeting else it
                    }
                    _uiState.value = _uiState.value.copy(upcomingMeetings = serverUpdatedMeetings)
                },
                onFailure = { error ->
                    // Revert on failure
                    val revertedMeetings = _uiState.value.upcomingMeetings.map {
                        if (it.id == meeting.id) meeting else it
                    }
                    _uiState.value = _uiState.value.copy(
                        upcomingMeetings = revertedMeetings,
                        error = "Failed to update: ${error.message}"
                    )
                }
            )
        }
    }

    /**
     * Sets the transcription language of an upcoming (calendar) meeting via PATCH. "auto" is sent
     * explicitly: it means "this meeting, auto-detect", not "follow my default".
     */
    fun setMeetingLanguage(meeting: Meeting, code: String) {
        val chosen = MeetingLanguages.normalize(code)
        if (!_uiState.value.languageCatalog.contains(chosen)) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                upcomingMeetings = _uiState.value.upcomingMeetings.map {
                    if (it.id == meeting.id) it.copy(transcriptionLanguage = chosen) else it
                }
            )
            meetingsRepository.updateMeeting(meeting.id, transcriptionLanguage = chosen).fold(
                onSuccess = { updated ->
                    _uiState.value = _uiState.value.copy(
                        upcomingMeetings = _uiState.value.upcomingMeetings.map {
                            if (it.id == meeting.id) updated.copy(transcriptionLanguage = updated.transcriptionLanguage ?: chosen) else it
                        }
                    )
                },
                onFailure = {
                    _uiState.value = _uiState.value.copy(
                        upcomingMeetings = _uiState.value.upcomingMeetings.map { if (it.id == meeting.id) meeting else it },
                        error = "Failed to update: ${it.message}"
                    )
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
