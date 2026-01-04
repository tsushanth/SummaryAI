package com.kreativekoala.summaryai.ui.meetings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.CalendarRepository
import com.kreativekoala.summaryai.data.repository.MeetingsRepository
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
    val hasCalendarConnected: Boolean = false
)

@HiltViewModel
class MeetingsViewModel @Inject constructor(
    private val meetingsRepository: MeetingsRepository,
    private val calendarRepository: CalendarRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(MeetingsUiState())
    val uiState: StateFlow<MeetingsUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    fun refresh() {
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            // Load calendar connections
            val connectionsResult = calendarRepository.getConnections()
            connectionsResult.onSuccess { connections ->
                _uiState.value = _uiState.value.copy(
                    calendarConnections = connections,
                    hasCalendarConnected = connections.any { it.isActive }
                )
            }

            // Load meetings
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
            if (meeting.autoJoin) {
                // Cancel bot
                meetingsRepository.cancelMeetingBot(meeting.id)
            } else {
                // Schedule bot
                meetingsRepository.scheduleMeetingBot(meeting.id, autoJoin = true)
            }
            loadData()
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
