package com.kreativekoala.summaryai.ui.meetings

import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.MeetingsRepository
import com.kreativekoala.summaryai.domain.model.LiveTranscriptSegment
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LiveTranscriptUiState(
    val segments: List<LiveTranscriptSegment> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val hasMore: Boolean = false
)

@HiltViewModel
class LiveTranscriptViewModel @Inject constructor(
    private val meetingsRepository: MeetingsRepository
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
        }
    }

    /**
     * Start polling for live transcript updates
     */
    fun startPolling() {
        pollingJob?.cancel()

        pollingJob = viewModelScope.launch {
            // Initial fetch
            fetchTranscript()

            // Poll every 2 seconds
            while (true) {
                delay(2000)
                fetchTranscript()
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
