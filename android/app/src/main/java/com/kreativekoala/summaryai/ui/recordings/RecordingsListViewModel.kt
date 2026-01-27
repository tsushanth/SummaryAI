package com.kreativekoala.summaryai.ui.recordings

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import com.kreativekoala.summaryai.domain.model.RecordingType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val TAG = "RecordingsListVM"

enum class RecordingsTab {
    ALL,
    MEETINGS,
    TODOS,
    FAVORITES,
    IMPORTED
}

data class RecordingsListUiState(
    val allRecordings: List<Recording> = emptyList(),
    val filteredRecordings: List<Recording> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val selectedTab: RecordingsTab = RecordingsTab.ALL,
    val error: String? = null,
    val hasMore: Boolean = true,
    val currentPage: Int = 1
) {
    // For backwards compatibility
    val recordings: List<Recording> get() = filteredRecordings
}

@HiltViewModel
class RecordingsListViewModel @Inject constructor(
    private val recordingsRepository: RecordingsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RecordingsListUiState())
    val uiState: StateFlow<RecordingsListUiState> = _uiState.asStateFlow()

    private var pollingActive = false

    init {
        Log.i(TAG, "RecordingsListViewModel init - loading recordings")
        loadRecordings()
        startPolling()
    }

    fun selectTab(tab: RecordingsTab) {
        if (_uiState.value.selectedTab != tab) {
            _uiState.value = _uiState.value.copy(
                selectedTab = tab,
                currentPage = 1,
                hasMore = true
            )
            applyFilter()
        }
    }

    fun refresh() {
        Log.i(TAG, "=== refresh() called ===")
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

    fun toggleFavorite(recording: Recording) {
        viewModelScope.launch {
            val newFavoriteStatus = !recording.isFavorite
            // Optimistically update the UI
            val updatedRecordings = _uiState.value.allRecordings.map {
                if (it.id == recording.id) it.copy(isFavorite = newFavoriteStatus) else it
            }
            _uiState.value = _uiState.value.copy(allRecordings = updatedRecordings)
            applyFilter()

            // Call API
            recordingsRepository.toggleFavorite(recording.id, newFavoriteStatus).fold(
                onSuccess = { updatedRecording ->
                    // Update with server response
                    val serverUpdatedRecordings = _uiState.value.allRecordings.map {
                        if (it.id == recording.id) updatedRecording else it
                    }
                    _uiState.value = _uiState.value.copy(allRecordings = serverUpdatedRecordings)
                    applyFilter()
                },
                onFailure = { error ->
                    // Revert on failure
                    val revertedRecordings = _uiState.value.allRecordings.map {
                        if (it.id == recording.id) it.copy(isFavorite = recording.isFavorite) else it
                    }
                    _uiState.value = _uiState.value.copy(
                        allRecordings = revertedRecordings,
                        error = "Failed to update favorite: ${error.message}"
                    )
                    applyFilter()
                }
            )
        }
    }

    fun deleteRecording(recording: Recording) {
        viewModelScope.launch {
            // Optimistically remove from UI
            val updatedRecordings = _uiState.value.allRecordings.filter { it.id != recording.id }
            _uiState.value = _uiState.value.copy(allRecordings = updatedRecordings)
            applyFilter()

            // Call API
            recordingsRepository.deleteRecording(recording.id).fold(
                onSuccess = {
                    // Already removed from UI
                },
                onFailure = { error ->
                    // Revert on failure - add the recording back
                    val revertedRecordings = _uiState.value.allRecordings + recording
                    _uiState.value = _uiState.value.copy(
                        allRecordings = revertedRecordings,
                        error = "Failed to delete recording: ${error.message}"
                    )
                    applyFilter()
                }
            )
        }
    }

    private fun applyFilter() {
        val allRecordings = _uiState.value.allRecordings
        val filtered = when (_uiState.value.selectedTab) {
            RecordingsTab.ALL -> allRecordings
            RecordingsTab.MEETINGS -> allRecordings.filter { it.recordingType == RecordingType.MEETING }
            RecordingsTab.TODOS -> emptyList() // Todos are handled in a separate screen
            RecordingsTab.FAVORITES -> allRecordings.filter { it.isFavorite }
            RecordingsTab.IMPORTED -> allRecordings.filter { it.recordingType == RecordingType.IMPORTED }
        }
        _uiState.value = _uiState.value.copy(filteredRecordings = filtered)
    }

    private fun loadRecordings(append: Boolean = false) {
        viewModelScope.launch {
            Log.i(TAG, "loadRecordings() called - append=$append, page=${_uiState.value.currentPage}")
            if (!append) {
                _uiState.value = _uiState.value.copy(isLoading = true)
            }

            val result = recordingsRepository.getRecordings(
                page = _uiState.value.currentPage
            )

            result.fold(
                onSuccess = { recordings ->
                    Log.i(TAG, "loadRecordings SUCCESS - received ${recordings.size} recordings")
                    recordings.take(3).forEach { rec ->
                        Log.d(TAG, "  Recording: id=${rec.id}, title=${rec.title}, status=${rec.status}")
                    }
                    val currentRecordings = if (append) _uiState.value.allRecordings else emptyList()
                    val allRecordings = currentRecordings + recordings
                    _uiState.value = _uiState.value.copy(
                        allRecordings = allRecordings,
                        isLoading = false,
                        isRefreshing = false,
                        hasMore = recordings.size >= 20,
                        error = null
                    )
                    applyFilter()
                    Log.i(TAG, "UI state updated - total recordings: ${allRecordings.size}, filtered: ${_uiState.value.filteredRecordings.size}")
                },
                onFailure = { error ->
                    Log.e(TAG, "loadRecordings FAILED: ${error.message}", error)
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
                val hasProcessing = _uiState.value.allRecordings.any { it.isProcessing }
                if (hasProcessing) {
                    refreshSilently()
                }
            }
        }
    }

    private suspend fun refreshSilently() {
        val result = recordingsRepository.getRecordings(
            page = 1,
            perPage = _uiState.value.allRecordings.size.coerceAtLeast(20)
        )

        result.onSuccess { recordings ->
            _uiState.value = _uiState.value.copy(allRecordings = recordings)
            applyFilter()
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
