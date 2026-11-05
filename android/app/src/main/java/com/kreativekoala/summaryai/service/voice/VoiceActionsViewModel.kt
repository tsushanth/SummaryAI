package com.kreativekoala.summaryai.service.voice

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class VoicePhase { IDLE, LISTENING, WORKING, SPEAKING }

data class VoiceUiState(
    val available: Boolean = false,
    val open: Boolean = false,
    val phase: VoicePhase = VoicePhase.IDLE,
    val heard: String = "",
    val spoken: String = "",
    /** The draft shown on the confirm sheet; kept after saving so "add to calendar" still works. */
    val draft: ActionDraft? = null,
    val canUndo: Boolean = false,
    val needsConsent: Boolean = false,
    val needsMicPermission: Boolean = false,
    val message: String? = null,
    /** Set when the user chose Edit; the screen opens its add-todo dialog with this and calls [VoiceActionsViewModel.editorHandled]. */
    val editorDraft: ActionDraft? = null,
)

@HiltViewModel
class VoiceActionsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val gate: VoiceFeatureGate,
    client: VoiceToolsClient,
    todos: TodoMutations,
    private val input: AndroidSpeechInput,
    private val output: AndroidSpeechOutput,
) : ViewModel() {

    private val funnel = VoiceFunnel()
    private val consent = VoiceConsentStore(context.getSharedPreferences(VoiceConsentStore.PREFS_NAME, Context.MODE_PRIVATE))
    private val session = VoiceSession(client, todos, funnel, loudspeaker = { AudioRoute.isLoudspeaker(context) })

    private val _ui = MutableStateFlow(VoiceUiState())
    val ui: StateFlow<VoiceUiState> = _ui.asStateFlow()

    private var job: Job? = null
    private var pendingStart: (() -> Unit)? = null
    private var surface: String = "todos"

    init {
        viewModelScope.launch {
            val ok = gate.isAvailable()
            _ui.update { it.copy(available = ok) }
        }
    }

    /** Mic tapped on the Todos screen: listen for a command. */
    fun startListening(surface: String, recordingId: String?) = begin(surface, recordingId) { converse(null) }

    /** "Hear debrief" tapped on a meeting. */
    fun startDebrief(recordingId: String) = begin("meeting", recordingId) {
        _ui.update { it.copy(phase = VoicePhase.WORKING) }
        converse { session.startDebrief(recordingId) }
    }

    fun onEntryShown(surface: String) = funnel.entryShown(surface)

    private fun begin(surface: String, recordingId: String?, start: () -> Unit) {
        this.surface = surface
        funnel.entryTapped(surface)
        if (session.state !is VoiceState.Undoable) session.reset()
        session.currentRecordingId = recordingId
        _ui.update { VoiceUiState(available = it.available, open = true) }
        if (!consent.hasConsent()) {
            funnel.log(VoiceEvents.CONSENT_SHOWN)
            pendingStart = start
            _ui.update { it.copy(needsConsent = true) }
            return
        }
        _ui.update { it.copy(needsMicPermission = true) }
        pendingStart = start
    }

    fun acceptConsent() {
        consent.accept()
        funnel.log(VoiceEvents.CONSENT_ACCEPTED)
        _ui.update { it.copy(needsConsent = false, needsMicPermission = true) }
    }

    fun declineConsent() {
        funnel.log(VoiceEvents.CONSENT_DECLINED)
        pendingStart = null
        close()
    }

    /** Called by the screen after it asked for (or already had) the microphone permission. */
    fun onMicPermission(granted: Boolean) {
        _ui.update { it.copy(needsMicPermission = false) }
        if (!granted) {
            funnel.log(VoiceEvents.MIC_DENIED)
            _ui.update { it.copy(message = "Microphone permission is needed to listen.") }
            pendingStart = null
            return
        }
        pendingStart?.invoke()
        pendingStart = null
    }

    /** Buttons on the sheet: the same words as speaking, so a tap is an equally clear answer. */
    fun tapSave() = tapReply("yes")
    fun tapCancel() = tapReply("no")
    fun tapEdit() = tapReply("edit")
    fun tapUndo() = tapReply("undo")

    private fun tapReply(word: String) {
        job?.cancel()
        input.cancel()
        output.stop()
        converse { session.onHeard(word) }
    }

    fun editorHandled() = _ui.update { it.copy(editorDraft = null) }

    fun close() {
        job?.cancel()
        input.cancel()
        output.stop()
        pendingStart = null
        _ui.update { it.copy(open = false, phase = VoicePhase.IDLE, needsConsent = false, needsMicPermission = false) }
    }

    fun clearMessage() = _ui.update { it.copy(message = null) }

    override fun onCleared() {
        input.cancel()
        output.shutdown()
        super.onCleared()
    }

    // ---- the conversation loop ---------------------------------------------------------------------------------

    private fun converse(first: (suspend () -> VoiceReply)?) {
        job?.cancel()
        job = viewModelScope.launch {
            var reply: VoiceReply? = first?.invoke()
            var turns = 0
            while (turns++ < MAX_TURNS) {
                if (reply != null) {
                    show(reply)
                    if (reply.openEditor != null) {
                        _ui.update { it.copy(editorDraft = reply!!.openEditor, open = false, phase = VoicePhase.IDLE) }
                        return@launch
                    }
                    _ui.update { it.copy(phase = VoicePhase.SPEAKING) }
                    output.speak(reply.speech)
                    reply.debriefCounts?.let { (d, a) -> funnel.debriefFinished(listenedPercent = 100, decisions = d, actions = a) }
                    if (!reply.listen) {
                        _ui.update { it.copy(phase = VoicePhase.IDLE) }
                        return@launch
                    }
                }
                _ui.update { it.copy(phase = VoicePhase.LISTENING) }
                when (val r = input.listenOnce()) {
                    is ListenResult.Heard -> {
                        funnel.heard(if (r.onDevice) "on_device" else "network", r.text.length, r.durationMs)
                        _ui.update { it.copy(heard = r.text, phase = VoicePhase.WORKING) }
                        reply = session.onHeard(r.text)
                    }
                    ListenResult.Silence -> {
                        reply = session.onSilence()
                        if (reply.speech.isBlank()) {
                            _ui.update { it.copy(phase = VoicePhase.IDLE, message = "I did not hear anything.") }
                            return@launch
                        }
                    }
                    ListenResult.PermissionDenied -> {
                        funnel.log(VoiceEvents.MIC_DENIED)
                        _ui.update { it.copy(phase = VoicePhase.IDLE, message = "Microphone permission is needed to listen.") }
                        return@launch
                    }
                    ListenResult.Unavailable -> {
                        funnel.notUnderstood("recognizer_missing")
                        _ui.update { it.copy(phase = VoicePhase.IDLE, message = "Speech recognition is not available on this phone.") }
                        return@launch
                    }
                    is ListenResult.Failed -> {
                        funnel.notUnderstood("recognizer_error")
                        _ui.update { it.copy(phase = VoicePhase.IDLE, message = "Listening failed. Try again.") }
                        return@launch
                    }
                }
            }
            _ui.update { it.copy(phase = VoicePhase.IDLE) }
        }
    }

    private fun show(reply: VoiceReply) {
        val s = reply.state
        _ui.update {
            it.copy(
                spoken = reply.speech,
                draft = (s as? VoiceState.ConfirmingAction)?.draft ?: it.draft.takeIf { _ -> s is VoiceState.Undoable },
                canUndo = s is VoiceState.Undoable,
            )
        }
    }

    companion object {
        private const val MAX_TURNS = 8
    }
}
