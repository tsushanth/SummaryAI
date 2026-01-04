package com.kreativekoala.summaryai.ui.meetings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.MeetingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class JoinMeetingUiState(
    val meetingUrl: String = "",
    val title: String = "",
    val isJoining: Boolean = false,
    val meetingJoined: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class JoinMeetingViewModel @Inject constructor(
    private val meetingsRepository: MeetingsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(JoinMeetingUiState())
    val uiState: StateFlow<JoinMeetingUiState> = _uiState.asStateFlow()

    fun updateMeetingUrl(url: String) {
        _uiState.value = _uiState.value.copy(meetingUrl = url)
    }

    fun updateTitle(title: String) {
        _uiState.value = _uiState.value.copy(title = title)
    }

    fun joinMeeting() {
        val state = _uiState.value
        if (state.meetingUrl.isBlank()) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isJoining = true, error = null)

            val result = meetingsRepository.joinMeeting(
                meetingUrl = state.meetingUrl,
                title = state.title.ifBlank { null }
            )

            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isJoining = false,
                        meetingJoined = true
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isJoining = false,
                        error = error.message ?: "Failed to join meeting"
                    )
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
