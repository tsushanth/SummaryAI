package com.kreativekoala.summaryai.ui.livecaption

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.service.LiveSpeechRecognizer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * Bridges [LiveSpeechRecognizer] (which already exists for the meeting
 * recording feature) into a dedicated Live Caption screen for the
 * deaf / hard-of-hearing audience.
 *
 * Live Caption ≠ meeting recording: the user just wants a streaming
 * transcript of nearby speech, no audio file, no upload, no AI summary.
 * Compose the existing recognizer into a thin UI state object and let
 * the screen render it. Lifecycle is bound to the ViewModel — leaving
 * the screen stops listening automatically.
 */
@HiltViewModel
class LiveCaptionViewModel @Inject constructor(
    private val recognizer: LiveSpeechRecognizer,
) : ViewModel() {

    data class UiState(
        val transcript: String = "",
        val isListening: Boolean = false,
        val errorMessage: String? = null,
        val onDeviceAvailable: Boolean = true,
    )

    val uiState: StateFlow<UiState> = combine(
        recognizer.transcript,
        recognizer.isRunning,
        recognizer.errorMessage,
    ) { transcript, isRunning, error ->
        UiState(
            transcript = transcript,
            isListening = isRunning,
            errorMessage = error,
            onDeviceAvailable = recognizer.supportsOnDevice,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = UiState(onDeviceAvailable = recognizer.supportsOnDevice),
    )

    /** Toggle listening on/off. The recognizer handles its own restart loop. */
    fun toggle() {
        if (recognizer.isRunning.value) {
            recognizer.stop()
        } else {
            recognizer.start(languageTag = null) // device default locale
        }
    }

    override fun onCleared() {
        // Belt-and-suspenders: if the user navigates away without stopping,
        // make sure the microphone is released.
        if (recognizer.isRunning.value) recognizer.stop()
        super.onCleared()
    }
}
