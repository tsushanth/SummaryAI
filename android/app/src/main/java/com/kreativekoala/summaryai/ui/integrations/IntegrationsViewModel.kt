package com.kreativekoala.summaryai.ui.integrations

import android.content.Context
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.IntegrationDto
import com.kreativekoala.summaryai.data.repository.IntegrationsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * A user-visible message that is resolved to the current locale by the UI, so the ViewModel never
 * needs a Context. [detail] is server-provided text (e.g. "Address is not allowed"), shown after
 * the localized text when present.
 */
data class UiMessage(@StringRes val resId: Int, val detail: String? = null) {
    fun resolve(context: Context): String {
        val base = context.getString(resId)
        val d = detail?.takeIf { it.isNotBlank() } ?: return base
        return context.getString(R.string.integrations_message_with_detail, base, d)
    }
}

data class IntegrationsUiState(
    val integrations: Map<String, IntegrationDto> = emptyMap(),
    val isLoading: Boolean = false,
    /** kind currently being saved/tested/removed, or null */
    val busyKind: String? = null,
    val message: UiMessage? = null
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
                    _uiState.update { it.copy(isLoading = false, message = UiMessage(R.string.integrations_load_failed, e.message)) }
                }
            )
        }
    }

    fun save(kind: String, url: String?, secret: String?, databaseId: String?, onResult: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            _uiState.update { it.copy(busyKind = kind) }
            repository.save(kind, url, secret, databaseId).fold(
                onSuccess = { dto ->
                    _uiState.update {
                        it.copy(
                            busyKind = null,
                            integrations = it.integrations + (dto.kind to dto),
                            message = UiMessage(R.string.integrations_saved)
                        )
                    }
                    onResult(true)
                },
                onFailure = { e ->
                    _uiState.update { it.copy(busyKind = null, message = UiMessage(R.string.integrations_save_failed, e.message)) }
                    onResult(false)
                }
            )
        }
    }

    fun remove(kind: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(busyKind = kind) }
            repository.delete(kind).fold(
                onSuccess = {
                    _uiState.update { it.copy(busyKind = null, integrations = it.integrations - kind, message = UiMessage(R.string.integrations_removed)) }
                },
                onFailure = { e ->
                    _uiState.update { it.copy(busyKind = null, message = UiMessage(R.string.integrations_remove_failed, e.message)) }
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
                            message = if (r.ok) UiMessage(R.string.integrations_test_delivered)
                            else UiMessage(R.string.integrations_test_failed, r.error)
                        )
                    }
                    refresh()
                },
                onFailure = { e ->
                    _uiState.update { it.copy(busyKind = null, message = UiMessage(R.string.integrations_test_failed, e.message)) }
                }
            )
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}
