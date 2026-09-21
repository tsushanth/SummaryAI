package com.kreativekoala.summaryai.ui.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.domain.model.Recording
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchUiState(
    val query: String = "",
    val results: List<Recording> = emptyList(),
    val allRecordings: List<Recording> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val recordingsRepository: RecordingsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null

    private companion object {
        const val PAGE_SIZE = 50
        const val MAX_PAGES = 6
    }

    init {
        loadAllRecordings()
    }

    private fun loadAllRecordings(): Job {
        return viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            // Backend caps per_page at 50 (a request for 100 returns HTTP 400), so page through
            val all = mutableListOf<Recording>()
            var failure: Throwable? = null
            for (page in 1..MAX_PAGES) {
                val result = recordingsRepository.getRecordings(page = page, perPage = PAGE_SIZE)
                if (result.isFailure) {
                    failure = result.exceptionOrNull()
                    break
                }
                val batch = result.getOrThrow()
                all += batch
                if (batch.size < PAGE_SIZE) break
            }

            _uiState.value = if (failure == null || all.isNotEmpty()) {
                _uiState.value.copy(allRecordings = all, isLoading = false)
            } else {
                _uiState.value.copy(isLoading = false, error = failure?.message)
            }
        }
    }

    fun updateQuery(query: String) {
        _uiState.value = _uiState.value.copy(query = query)

        // Debounce search
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(300)
            // The initial load can fail (e.g. backend timeout); without a retry every search
            // then reports "No results found" for the rest of the session.
            if (query.isNotBlank() && _uiState.value.allRecordings.isEmpty()) {
                loadAllRecordings().join()
            }
            performSearch(query)
        }
    }

    private fun performSearch(query: String) {
        if (query.isBlank()) {
            _uiState.value = _uiState.value.copy(results = emptyList())
            return
        }

        val lowerQuery = query.lowercase()
        val results = _uiState.value.allRecordings.filter { recording ->
            recording.title.lowercase().contains(lowerQuery)
        }

        _uiState.value = _uiState.value.copy(results = results)
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
