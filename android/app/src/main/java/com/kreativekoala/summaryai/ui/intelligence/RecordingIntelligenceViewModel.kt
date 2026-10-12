package com.kreativekoala.summaryai.ui.intelligence

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.api.models.SummaryTemplateDto
import com.kreativekoala.summaryai.data.repository.IntelligenceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class EmailDraft(val subject: String = "", val body: String = "")

data class RecordingIntelligenceState(
    val templates: List<SummaryTemplateDto> = emptyList(),
    val defaultTemplate: String? = null,
    /** Template chosen in the picker; null until the user picks one. */
    val pickedTemplate: String? = null,
    /** Template the shown summary was generated with, once known from a regenerate in this session. */
    val appliedTemplate: String? = null,
    val isRegenerating: Boolean = false,
    val showEmailSheet: Boolean = false,
    val isDraftingEmail: Boolean = false,
    val emailDraft: EmailDraft? = null,
    val isAddingTodos: Boolean = false
)

sealed interface IntelligenceEvent {
    data object TemplatesFailed : IntelligenceEvent
    data object Regenerated : IntelligenceEvent
    data object RegenerateFailed : IntelligenceEvent
    data object EmailFailed : IntelligenceEvent
    data class TodosAdded(val added: Int, val skipped: Int) : IntelligenceEvent
    data object TodosFailed : IntelligenceEvent
}

/** Scoped to the recording detail nav entry; reads `recordingId` from the nav args. */
@HiltViewModel
class RecordingIntelligenceViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repository: IntelligenceRepository
) : ViewModel() {

    private val recordingId: String = savedStateHandle.get<String>("recordingId") ?: ""

    private val _state = MutableStateFlow(RecordingIntelligenceState())
    val state: StateFlow<RecordingIntelligenceState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<IntelligenceEvent>(extraBufferCapacity = 4)
    val events: SharedFlow<IntelligenceEvent> = _events.asSharedFlow()

    init {
        viewModelScope.launch {
            repository.getTemplates().fold(
                onSuccess = { r ->
                    _state.update { it.copy(templates = r.templates, defaultTemplate = r.defaultTemplate) }
                },
                onFailure = { _events.tryEmit(IntelligenceEvent.TemplatesFailed) }
            )
        }
    }

    fun pickTemplate(id: String) {
        _state.update { it.copy(pickedTemplate = id) }
    }

    /** Replaces the stored summary; [onDone] runs on success so the caller can reload the recording. */
    fun regenerate(template: String, onDone: () -> Unit) {
        if (_state.value.isRegenerating) return
        _state.update { it.copy(isRegenerating = true) }
        viewModelScope.launch {
            repository.regenerateSummary(recordingId, template).fold(
                onSuccess = { applied ->
                    _state.update { it.copy(isRegenerating = false, appliedTemplate = applied ?: template) }
                    _events.tryEmit(IntelligenceEvent.Regenerated)
                    onDone()
                },
                onFailure = {
                    _state.update { it.copy(isRegenerating = false) }
                    _events.tryEmit(IntelligenceEvent.RegenerateFailed)
                }
            )
        }
    }

    fun openEmailSheet() {
        _state.update { it.copy(showEmailSheet = true) }
        if (_state.value.emailDraft == null) draftEmail()
    }

    fun closeEmailSheet() {
        _state.update { it.copy(showEmailSheet = false) }
    }

    fun draftEmail() {
        if (_state.value.isDraftingEmail) return
        _state.update { it.copy(isDraftingEmail = true) }
        viewModelScope.launch {
            repository.followUpEmail(recordingId).fold(
                onSuccess = { r ->
                    _state.update { it.copy(isDraftingEmail = false, emailDraft = EmailDraft(r.subject, r.body)) }
                },
                onFailure = {
                    _state.update { it.copy(isDraftingEmail = false, showEmailSheet = false) }
                    _events.tryEmit(IntelligenceEvent.EmailFailed)
                }
            )
        }
    }

    fun editDraft(subject: String, body: String) {
        _state.update { it.copy(emailDraft = EmailDraft(subject, body)) }
    }

    fun addActionItemsToTodos() {
        if (_state.value.isAddingTodos) return
        _state.update { it.copy(isAddingTodos = true) }
        viewModelScope.launch {
            repository.actionItemsToTodos(recordingId).fold(
                onSuccess = { r ->
                    _state.update { it.copy(isAddingTodos = false) }
                    _events.tryEmit(IntelligenceEvent.TodosAdded(r.todos.size, r.skipped))
                },
                onFailure = {
                    _state.update { it.copy(isAddingTodos = false) }
                    _events.tryEmit(IntelligenceEvent.TodosFailed)
                }
            )
        }
    }
}
