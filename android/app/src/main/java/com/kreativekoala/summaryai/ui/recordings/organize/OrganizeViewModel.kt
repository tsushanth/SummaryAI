package com.kreativekoala.summaryai.ui.recordings.organize

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.api.models.CreateShareResponse
import com.kreativekoala.summaryai.data.api.models.FolderDto
import com.kreativekoala.summaryai.data.api.models.ShareDto
import com.kreativekoala.summaryai.data.repository.OrganizeRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class OrganizeUiState(
    val folders: List<FolderDto> = emptyList(),
    val busy: Boolean = false,
    val error: String? = null,
)

/** Folder assignment / tag editing for one recording (bottom sheet). */
@HiltViewModel
class OrganizeViewModel @Inject constructor(
    private val repository: OrganizeRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(OrganizeUiState())
    val state: StateFlow<OrganizeUiState> = _state.asStateFlow()

    init {
        reloadFolders()
    }

    private fun reloadFolders() {
        viewModelScope.launch {
            repository.getFolders().onSuccess { f -> _state.update { it.copy(folders = f) } }
        }
    }

    /** Runs [call], reports failure in state, and invokes [onDone] on success. */
    private fun <T> launchCall(call: suspend () -> Result<T>, onDone: (T) -> Unit = {}) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            call().fold(
                onSuccess = { v ->
                    _state.update { it.copy(busy = false) }
                    onDone(v)
                },
                onFailure = { e ->
                    _state.update { it.copy(busy = false, error = e.message ?: "Something went wrong") }
                },
            )
        }
    }

    fun moveToFolder(recordingId: String, folderId: String?, onDone: () -> Unit) =
        launchCall({ repository.moveToFolder(recordingId, folderId) }) { onDone() }

    fun createFolderAndMove(recordingId: String, name: String, onDone: () -> Unit) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            val created = repository.createFolder(name)
            val folder = created.getOrNull()
            if (folder == null) {
                _state.update { it.copy(busy = false, error = created.exceptionOrNull()?.message ?: "Could not create folder") }
                return@launch
            }
            val moved = repository.moveToFolder(recordingId, folder.id)
            _state.update { it.copy(busy = false, error = moved.exceptionOrNull()?.message) }
            reloadFolders()
            if (moved.isSuccess) onDone()
        }
    }

    fun setTags(recordingId: String, tags: List<String>, onDone: () -> Unit) =
        launchCall({ repository.setTags(recordingId, tags) }) { onDone() }
}

data class PublicLinkUiState(
    val shares: List<ShareDto> = emptyList(),
    val created: CreateShareResponse? = null,
    val busy: Boolean = false,
    val error: String? = null,
)

/** Creates / lists / revokes public share links for one recording. */
@HiltViewModel
class PublicLinkViewModel @Inject constructor(
    private val repository: OrganizeRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(PublicLinkUiState())
    val state: StateFlow<PublicLinkUiState> = _state.asStateFlow()

    fun load(recordingId: String) {
        viewModelScope.launch {
            repository.getShares(recordingId).fold(
                onSuccess = { s -> _state.update { it.copy(shares = s.filter { x -> x.revokedAt == null }) } },
                onFailure = { e -> _state.update { it.copy(error = e.message) } },
            )
        }
    }

    fun create(recordingId: String, includeTranscript: Boolean, expiresInDays: Int?) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            repository.createShare(recordingId, includeTranscript, expiresInDays).fold(
                onSuccess = { r -> _state.update { it.copy(busy = false, created = r) } },
                onFailure = { e -> _state.update { it.copy(busy = false, error = e.message ?: "Could not create link") } },
            )
            load(recordingId)
        }
    }

    fun revoke(recordingId: String, shareId: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            repository.revokeShare(recordingId, shareId).fold(
                onSuccess = { _state.update { it.copy(busy = false) } },
                onFailure = { e -> _state.update { it.copy(busy = false, error = e.message ?: "Could not revoke link") } },
            )
            load(recordingId)
        }
    }
}
