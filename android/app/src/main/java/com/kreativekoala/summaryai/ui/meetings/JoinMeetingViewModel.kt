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
    val botName: String = "",
    val isJoining: Boolean = false,
    val meetingJoined: Boolean = false,
    val joinedRecordingId: String? = null,
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
                        joinedRecordingId = recordingId
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
