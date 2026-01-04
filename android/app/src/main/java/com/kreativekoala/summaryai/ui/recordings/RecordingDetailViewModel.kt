package com.kreativekoala.summaryai.ui.recordings

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.domain.model.RecordingDetail
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class DetailTab {
    SUMMARY,
    TRANSCRIPT,
    ACTION_ITEMS
}

data class QAMessage(
    val id: String,
    val question: String,
    val answer: String? = null,
    val isLoading: Boolean = false
)

data class RecordingDetailUiState(
    val recordingDetail: RecordingDetail? = null,
    val isLoading: Boolean = true,
    val selectedTab: DetailTab = DetailTab.SUMMARY,
    val qaMessages: List<QAMessage> = emptyList(),
    val currentQuestion: String = "",
    val isAskingQuestion: Boolean = false,
    val error: String? = null,
    val isDeleting: Boolean = false,
    val deleted: Boolean = false
)

@HiltViewModel
class RecordingDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val recordingsRepository: RecordingsRepository
) : ViewModel() {

    private val recordingId: String = savedStateHandle.get<String>("recordingId") ?: ""

    private val _uiState = MutableStateFlow(RecordingDetailUiState())
    val uiState: StateFlow<RecordingDetailUiState> = _uiState.asStateFlow()

    private var pollingActive = false

    init {
        loadRecording()
    }

    fun selectTab(tab: DetailTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
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
                                answer = "Sorry, I couldn't answer that question. Please try again.",
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
                    _uiState.value = _uiState.value.copy(
                        recordingDetail = detail,
                        isLoading = false,
                        error = null
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
    }
}
