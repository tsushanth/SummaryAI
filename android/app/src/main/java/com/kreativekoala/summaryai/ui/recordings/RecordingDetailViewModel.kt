package com.kreativekoala.summaryai.ui.recordings

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.domain.model.RecordingDetail
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class DetailTab {
    SUMMARY,
    TRANSCRIPT,
    CHAT
}

data class QAMessage(
    val id: String,
    val question: String,
    val answer: String? = null,
    val isLoading: Boolean = false
)

data class AudioPlayerState(
    val isPlaying: Boolean = false,
    val currentPositionMs: Long = 0L,
    val durationMs: Long = 0L,
    val playbackSpeed: Float = 1f
) {
    val progress: Float
        get() = if (durationMs > 0) currentPositionMs.toFloat() / durationMs else 0f
}

data class RecordingDetailUiState(
    val recordingDetail: RecordingDetail? = null,
    val isLoading: Boolean = true,
    val selectedTab: DetailTab = DetailTab.SUMMARY,
    val qaMessages: List<QAMessage> = emptyList(),
    val currentQuestion: String = "",
    val isAskingQuestion: Boolean = false,
    val error: String? = null,
    val isDeleting: Boolean = false,
    val deleted: Boolean = false,
    val showLiveTranscript: Boolean = true,  // Default to live for live meetings
    val audioPlayerState: AudioPlayerState = AudioPlayerState()
)

@HiltViewModel
class RecordingDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val recordingsRepository: RecordingsRepository,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val recordingId: String = savedStateHandle.get<String>("recordingId") ?: ""

    private val _uiState = MutableStateFlow(RecordingDetailUiState())
    val uiState: StateFlow<RecordingDetailUiState> = _uiState.asStateFlow()

    private var pollingActive = false
    private var positionUpdateActive = false

    private var exoPlayer: ExoPlayer? = null

    init {
        loadRecording()
    }

    private fun initializePlayer(audioUrl: String) {
        if (exoPlayer != null) return

        exoPlayer = ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(audioUrl))
            prepare()
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_READY) {
                        _uiState.value = _uiState.value.copy(
                            audioPlayerState = _uiState.value.audioPlayerState.copy(
                                durationMs = duration
                            )
                        )
                    }
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    _uiState.value = _uiState.value.copy(
                        audioPlayerState = _uiState.value.audioPlayerState.copy(
                            isPlaying = isPlaying
                        )
                    )
                    if (isPlaying) {
                        startPositionUpdates()
                    } else {
                        positionUpdateActive = false
                    }
                }
            })
        }
    }

    private fun startPositionUpdates() {
        if (positionUpdateActive) return
        positionUpdateActive = true

        viewModelScope.launch {
            while (positionUpdateActive) {
                exoPlayer?.let { player ->
                    _uiState.value = _uiState.value.copy(
                        audioPlayerState = _uiState.value.audioPlayerState.copy(
                            currentPositionMs = player.currentPosition
                        )
                    )
                }
                delay(100) // Update every 100ms
            }
        }
    }

    fun togglePlayPause() {
        val audioUrl = _uiState.value.recordingDetail?.recording?.audioUrl ?: return

        if (exoPlayer == null) {
            initializePlayer(audioUrl)
        }

        exoPlayer?.let { player ->
            if (player.isPlaying) {
                player.pause()
            } else {
                player.play()
            }
        }
    }

    fun seekTo(positionMs: Long) {
        exoPlayer?.seekTo(positionMs)
        _uiState.value = _uiState.value.copy(
            audioPlayerState = _uiState.value.audioPlayerState.copy(
                currentPositionMs = positionMs
            )
        )
    }

    fun seekForward() {
        exoPlayer?.let { player ->
            val newPosition = (player.currentPosition + 10000).coerceAtMost(player.duration)
            seekTo(newPosition)
        }
    }

    fun seekBackward() {
        exoPlayer?.let { player ->
            val newPosition = (player.currentPosition - 10000).coerceAtLeast(0)
            seekTo(newPosition)
        }
    }

    fun setPlaybackSpeed(speed: Float) {
        exoPlayer?.setPlaybackSpeed(speed)
        _uiState.value = _uiState.value.copy(
            audioPlayerState = _uiState.value.audioPlayerState.copy(
                playbackSpeed = speed
            )
        )
    }

    fun selectTab(tab: DetailTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    fun toggleLiveTranscript(showLive: Boolean) {
        _uiState.value = _uiState.value.copy(showLiveTranscript = showLive)
    }

    fun updateQuestion(question: String) {
        _uiState.value = _uiState.value.copy(currentQuestion = question)
    }

    fun askQuestion() {
        val question = _uiState.value.currentQuestion.trim()
        if (question.isBlank()) return

        val messageId = System.currentTimeMillis().toString()
        val newMessage = QAMessage(
            id = messageId,
            question = question,
            isLoading = true
        )

        _uiState.value = _uiState.value.copy(
            qaMessages = _uiState.value.qaMessages + newMessage,
            currentQuestion = "",
            isAskingQuestion = true
        )

        viewModelScope.launch {
            val result = recordingsRepository.askQuestion(recordingId, question)

            result.fold(
                onSuccess = { answer ->
                    _uiState.value = _uiState.value.copy(
                        qaMessages = _uiState.value.qaMessages.map {
                            if (it.id == messageId) it.copy(answer = answer, isLoading = false) else it
                        },
                        isAskingQuestion = false
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        qaMessages = _uiState.value.qaMessages.map {
                            if (it.id == messageId) it.copy(
                                answer = context.getString(R.string.error_qa_failed),
                                isLoading = false
                            ) else it
                        },
                        isAskingQuestion = false,
                        error = error.message
                    )
                }
            )
        }
    }

    fun deleteRecording() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isDeleting = true)

            val result = recordingsRepository.deleteRecording(recordingId)

            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isDeleting = false,
                        deleted = true
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isDeleting = false,
                        error = error.message
                    )
                }
            )
        }
    }

    private fun loadRecording() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            val result = recordingsRepository.getRecording(
                id = recordingId,
                includeTranscript = true,
                includeSummary = true
            )

            result.fold(
                onSuccess = { detail ->
                    // Default to Transcript tab for live meetings
                    val defaultTab = if (detail.recording.isLiveMeeting) {
                        DetailTab.TRANSCRIPT
                    } else {
                        DetailTab.SUMMARY
                    }

                    _uiState.value = _uiState.value.copy(
                        recordingDetail = detail,
                        isLoading = false,
                        error = null,
                        selectedTab = defaultTab
                    )

                    // Start polling if still processing
                    if (detail.recording.isProcessing) {
                        startPolling()
                    }
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

    private fun startPolling() {
        if (pollingActive) return
        pollingActive = true

        viewModelScope.launch {
            while (pollingActive) {
                delay(3000)

                val result = recordingsRepository.getRecording(
                    id = recordingId,
                    includeTranscript = true,
                    includeSummary = true
                )

                result.onSuccess { detail ->
                    _uiState.value = _uiState.value.copy(recordingDetail = detail)

                    if (!detail.recording.isProcessing) {
                        pollingActive = false
                    }
                }
            }
        }
    }

    fun refresh() {
        loadRecording()
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        pollingActive = false
        positionUpdateActive = false
        exoPlayer?.release()
        exoPlayer = null
    }
}
