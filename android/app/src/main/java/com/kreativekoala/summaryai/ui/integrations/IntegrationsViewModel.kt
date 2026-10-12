package com.kreativekoala.summaryai.ui.integrations

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.api.models.IntegrationDto
import com.kreativekoala.summaryai.data.repository.IntegrationsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class IntegrationsUiState(
    val integrations: Map<String, IntegrationDto> = emptyMap(),
    val isLoading: Boolean = false,
    /** kind currently being saved/tested/removed, or null */
    val busyKind: String? = null,
    val message: String? = null
)

@HiltViewModel
class IntegrationsViewModel @Inject constructor(
    private val repository: IntegrationsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(IntegrationsUiState())
    val uiState: StateFlow<IntegrationsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            repository.list().fold(
                onSuccess = { list ->
                    _uiState.update { it.copy(integrations = list.associateBy { i -> i.kind }, isLoading = false) }
                },
                onFailure = { e ->
                    _uiState.update { it.copy(isLoading = false, message = e.message ?: "Could not load integrations.") }
                }
            )
        }
    }

    fun save(kind: String, url: String?, secret: String?, databaseId: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(busyKind = kind) }
            repository.save(kind, url, secret, databaseId).fold(
                onSuccess = { dto ->
                    _uiState.update {
                        it.copy(
                            busyKind = null,
                            integrations = it.integrations + (dto.kind to dto),
                            message = "Saved."
                        )
                    }
                },
                onFailure = { e ->
                    _uiState.update { it.copy(busyKind = null, message = e.message ?: "Could not save.") }
                }
            )
        }
    }

    fun remove(kind: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(busyKind = kind) }
            repository.delete(kind).fold(
                onSuccess = {
                    _uiState.update { it.copy(busyKind = null, integrations = it.integrations - kind, message = "Removed.") }
                },
                onFailure = { e ->
                    _uiState.update { it.copy(busyKind = null, message = e.message ?: "Could not remove.") }
                }
            )
        }
    }

    fun test(kind: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(busyKind = kind) }
            repository.test(kind).fold(
                onSuccess = { r ->
                    _uiState.update {
                        it.copy(
                            busyKind = null,
                            message = if (r.ok) "Test delivered." else "Test failed: ${r.error ?: "unknown error"}"
                        )
                    }
                    refresh()
                },
                onFailure = { e ->
                    _uiState.update { it.copy(busyKind = null, message = e.message ?: "Test failed.") }
                }
            )
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}
