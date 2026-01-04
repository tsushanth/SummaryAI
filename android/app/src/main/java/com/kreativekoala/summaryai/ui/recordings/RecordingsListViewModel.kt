package com.kreativekoala.summaryai.ui.recordings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class RecordingsTab {
    ALL,
    PROCESSING,
    COMPLETED
}

data class RecordingsListUiState(
    val recordings: List<Recording> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val selectedTab: RecordingsTab = RecordingsTab.ALL,
    val error: String? = null,
    val hasMore: Boolean = true,
    val currentPage: Int = 1
)

@HiltViewModel
class RecordingsListViewModel @Inject constructor(
    private val recordingsRepository: RecordingsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RecordingsListUiState())
    val uiState: StateFlow<RecordingsListUiState> = _uiState.asStateFlow()

    private var pollingActive = false

    init {
        loadRecordings()
        startPolling()
    }

    fun selectTab(tab: RecordingsTab) {
        if (_uiState.value.selectedTab != tab) {
            _uiState.value = _uiState.value.copy(
                selectedTab = tab,
                recordings = emptyList(),
                currentPage = 1,
                hasMore = true
            )
            loadRecordings()
        }
    }

    fun refresh() {
        _uiState.value = _uiState.value.copy(
            isRefreshing = true,
            currentPage = 1,
            hasMore = true
        )
        loadRecordings()
    }

    fun loadMore() {
        if (_uiState.value.isLoading || !_uiState.value.hasMore) return

        val nextPage = _uiState.value.currentPage + 1
        _uiState.value = _uiState.value.copy(currentPage = nextPage)
        loadRecordings(append = true)
    }

    private fun loadRecordings(append: Boolean = false) {
        viewModelScope.launch {
            if (!append) {
                _uiState.value = _uiState.value.copy(isLoading = true)
            }

            val status = when (_uiState.value.selectedTab) {
                RecordingsTab.ALL -> null
                RecordingsTab.PROCESSING -> RecordingStatus.PROCESSING
                RecordingsTab.COMPLETED -> RecordingStatus.COMPLETED
            }

            val result = recordingsRepository.getRecordings(
                page = _uiState.value.currentPage,
                status = status?.let {
                    com.kreativekoala.summaryai.data.api.models.RecordingStatus.valueOf(it.name)
                }
            )

            result.fold(
                onSuccess = { recordings ->
                    val currentRecordings = if (append) _uiState.value.recordings else emptyList()
                    _uiState.value = _uiState.value.copy(
                        recordings = currentRecordings + recordings,
                        isLoading = false,
                        isRefreshing = false,
                        hasMore = recordings.size >= 20,
                        error = null
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        isRefreshing = false,
                        error = error.message
                    )
                }
            )
        }
    }

    private fun startPolling() {
        pollingActive = true
        viewModelScope.launch {
            while (pollingActive) {
                delay(5000) // Poll every 5 seconds

                // Only poll if we have processing recordings
                val hasProcessing = _uiState.value.recordings.any { it.isProcessing }
                if (hasProcessing) {
                    refreshSilently()
                }
            }
        }
    }

    private suspend fun refreshSilently() {
        val status = when (_uiState.value.selectedTab) {
            RecordingsTab.ALL -> null
            RecordingsTab.PROCESSING -> RecordingStatus.PROCESSING
            RecordingsTab.COMPLETED -> RecordingStatus.COMPLETED
        }

        val result = recordingsRepository.getRecordings(
            page = 1,
            perPage = _uiState.value.recordings.size.coerceAtLeast(20),
            status = status?.let {
                com.kreativekoala.summaryai.data.api.models.RecordingStatus.valueOf(it.name)
            }
        )

        result.onSuccess { recordings ->
            _uiState.value = _uiState.value.copy(recordings = recordings)
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        pollingActive = false
    }
}
