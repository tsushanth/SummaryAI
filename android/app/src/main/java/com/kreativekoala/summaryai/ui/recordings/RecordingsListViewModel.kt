package com.kreativekoala.summaryai.ui.recordings

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.api.models.FolderDto
import com.kreativekoala.summaryai.data.repository.OrganizeRepository
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import com.kreativekoala.summaryai.domain.model.RecordingType
import com.kreativekoala.summaryai.data.repository.RecordingsFilter
import com.kreativekoala.summaryai.service.AudioRecordingService
import com.kreativekoala.summaryai.ui.recordings.organize.DateRangeSelection
import com.kreativekoala.summaryai.ui.recordings.organize.buildRecordingsFilter
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
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
    val currentPage: Int = 1,
    // Organization. Folder / tag / date range / favorites are applied by the API (paged), not over loaded items.
    val folders: List<FolderDto> = emptyList(),
    val selectedFolderId: String? = null,
    val selectedTag: String? = null,
    val dateRange: DateRangeSelection? = null,
    /** All of the user's tags from GET /api/tags (not just those on loaded pages). */
    val serverTags: List<String> = emptyList()
) {
    /** Tags to offer as chips: the server's full list, else those on loaded recordings. */
    val tags: List<String>
        get() = (if (serverTags.isNotEmpty()) serverTags else allRecordings.flatMap { it.tags })
            .distinctBy { it.lowercase() }.sortedBy { it.lowercase() }

    /** True when any server-side filter (other than the tab) narrows the list. */
    val hasActiveFilter: Boolean
        get() = selectedFolderId != null || selectedTag != null || dateRange != null

    // For backwards compatibility
    val recordings: List<Recording> get() = filteredRecordings
}

data class PendingUpload(
    val file: File,
    val title: String,
    val durationSeconds: Int
)

@HiltViewModel
class RecordingsListViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val recordingsRepository: RecordingsRepository,
    private val organizeRepository: OrganizeRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RecordingsListUiState())
    val uiState: StateFlow<RecordingsListUiState> = _uiState.asStateFlow()

    private val _pendingUploads = MutableStateFlow<List<PendingUpload>>(emptyList())
    val pendingUploads: StateFlow<List<PendingUpload>> = _pendingUploads.asStateFlow()

    private var pollingActive = false

    /** Bumped on every (re)load so a slow response for an old filter cannot overwrite a newer one. */
    private var loadGeneration = 0

    private fun currentFilter(): RecordingsFilter {
        val s = _uiState.value
        return buildRecordingsFilter(
            favoritesTab = s.selectedTab == RecordingsTab.FAVORITES,
            folderId = s.selectedFolderId,
            tag = s.selectedTag,
            range = s.dateRange
        )
    }

    /** Filters changed: start over from page 1 against the server. */
    private fun reloadForFilterChange() {
        _uiState.value = _uiState.value.copy(currentPage = 1, hasMore = true, allRecordings = emptyList(), filteredRecordings = emptyList())
        loadRecordings()
    }

    init {
        Log.i(TAG, "RecordingsListViewModel init - loading recordings")
        loadRecordings()
        loadFolders()
        loadTags()
        startPolling()
        refreshPendingUploads()
    }

    fun refreshPendingUploads() {
        _pendingUploads.value = AudioRecordingService.listPendingUploads(context)
            .map { file -> readPendingUpload(file) }
    }

    private fun readPendingUpload(file: File): PendingUpload {
        val meta = File(file.parentFile, file.nameWithoutExtension + ".meta")
        var title = "Recovered recording"
        var duration = 0
        if (meta.exists()) {
            runCatching {
                meta.readLines().forEach { line ->
                    val (k, v) = line.split("=", limit = 2).let {
                        if (it.size == 2) it[0] to it[1] else return@forEach
                    }
                    when (k) {
                        "title" -> title = v
                        "duration" -> duration = v.toIntOrNull() ?: 0
                    }
                }
            }
        }
        return PendingUpload(file, title, duration)
    }

    fun retryPendingUpload(pending: PendingUpload) {
        val intent = Intent(context, AudioRecordingService::class.java).apply {
            action = AudioRecordingService.ACTION_UPLOAD
            putExtra(AudioRecordingService.EXTRA_FILE_PATH, pending.file.absolutePath)
            putExtra(AudioRecordingService.EXTRA_TITLE, pending.title)
            putExtra(AudioRecordingService.EXTRA_DURATION, pending.durationSeconds)
        }
        context.startForegroundService(intent)
        // Optimistically remove from banner; if it fails again the next refresh will re-list it.
        _pendingUploads.value = _pendingUploads.value.filterNot { it.file == pending.file }
    }

    fun discardPendingUpload(pending: PendingUpload) {
        pending.file.delete()
        File(pending.file.parentFile, pending.file.nameWithoutExtension + ".meta").delete()
        _pendingUploads.value = _pendingUploads.value.filterNot { it.file == pending.file }
    }

    fun loadFolders() {
        viewModelScope.launch {
            organizeRepository.getFolders().onSuccess { folders ->
                val selected = _uiState.value.selectedFolderId
                _uiState.value = _uiState.value.copy(
                    folders = folders,
                    // A folder deleted elsewhere must not leave the list filtered to nothing
                    selectedFolderId = if (selected != null && folders.none { it.id == selected }) null else selected
                )
                applyFilter()
            }
        }
    }

    fun loadTags() {
        viewModelScope.launch {
            organizeRepository.getTags().onSuccess { tags ->
                _uiState.value = _uiState.value.copy(serverTags = tags.map { it.tag })
            }
        }
    }

    fun selectFolder(folderId: String?) {
        if (_uiState.value.selectedFolderId == folderId) return
        _uiState.value = _uiState.value.copy(selectedFolderId = folderId)
        reloadForFilterChange()
    }

    fun selectTag(tag: String?) {
        if (_uiState.value.selectedTag == tag) return
        _uiState.value = _uiState.value.copy(selectedTag = tag)
        reloadForFilterChange()
    }

    fun selectDateRange(range: DateRangeSelection?) {
        if (_uiState.value.dateRange == range) return
        _uiState.value = _uiState.value.copy(dateRange = range)
        reloadForFilterChange()
    }

    fun clearFilters() {
        _uiState.value = _uiState.value.copy(selectedFolderId = null, selectedTag = null, dateRange = null)
        reloadForFilterChange()
    }

    fun selectTab(tab: RecordingsTab) {
        val old = _uiState.value.selectedTab
        if (old != tab) {
            _uiState.value = _uiState.value.copy(
                selectedTab = tab,
                currentPage = 1,
                hasMore = true
            )
            // Favorites is a server filter, so entering or leaving it needs a fresh page 1.
            if (old == RecordingsTab.FAVORITES || tab == RecordingsTab.FAVORITES) {
                _uiState.value = _uiState.value.copy(allRecordings = emptyList(), filteredRecordings = emptyList())
                loadRecordings()
            } else {
                applyFilter()
            }
        }
    }

    // ---- Folder management (create / rename / delete from the list screen) ----

    fun createFolder(name: String) {
        viewModelScope.launch {
            organizeRepository.createFolder(name).fold(
                onSuccess = { loadFolders() },
                onFailure = { _uiState.value = _uiState.value.copy(error = "Could not create folder: ${it.message}") }
            )
        }
    }

    fun renameFolder(folder: FolderDto, name: String) {
        viewModelScope.launch {
            organizeRepository.renameFolder(folder.id, name).fold(
                onSuccess = { loadFolders() },
                onFailure = { _uiState.value = _uiState.value.copy(error = "Could not rename folder: ${it.message}") }
            )
        }
    }

    fun deleteFolder(folder: FolderDto) {
        viewModelScope.launch {
            organizeRepository.deleteFolder(folder.id).fold(
                onSuccess = {
                    // Recordings in it are now unfiled; reload so the list and counts are truthful.
                    val wasSelected = _uiState.value.selectedFolderId == folder.id
                    if (wasSelected) _uiState.value = _uiState.value.copy(selectedFolderId = null)
                    loadFolders()
                    if (wasSelected) reloadForFilterChange() else loadRecordings()
                },
                onFailure = { _uiState.value = _uiState.value.copy(error = "Could not delete folder: ${it.message}") }
            )
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
        loadFolders()
        loadTags()
        refreshPendingUploads()
    }

    fun loadMore() {
        val state = _uiState.value
        // hasMore starts true and an empty list always looks "near the end", so without these
        // guards loadMore() fires page 2 while page 1 is still loading (or came back empty).
        if (state.isLoading || state.isRefreshing || !state.hasMore || state.allRecordings.isEmpty()) return

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
        // Folder / tag / date range / favorites are already applied by the server. Re-checking folder and tag
        // here only matters for optimistic edits (e.g. a recording just moved out of the selected folder).
        val folderId = _uiState.value.selectedFolderId
        val tag = _uiState.value.selectedTag
        val organized = filtered
            .let { list -> if (folderId != null) list.filter { it.folderId == folderId } else list }
            .let { list -> if (tag != null) list.filter { r -> r.tags.any { it.equals(tag, ignoreCase = true) } } else list }
        _uiState.value = _uiState.value.copy(filteredRecordings = organized)
    }

    private fun loadRecordings(append: Boolean = false) {
        viewModelScope.launch {
            Log.i(TAG, "loadRecordings() called - append=$append, page=${_uiState.value.currentPage}")
            if (!append) {
                _uiState.value = _uiState.value.copy(isLoading = true)
            }

            val generation = if (append) loadGeneration else ++loadGeneration
            val result = recordingsRepository.getRecordings(
                page = _uiState.value.currentPage,
                filter = currentFilter()
            )
            if (generation != loadGeneration) return@launch // a newer filter/refresh superseded this request

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
            perPage = _uiState.value.allRecordings.size.coerceIn(20, 50), // backend caps per_page at 50
            filter = currentFilter()
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
