package com.kreativekoala.summaryai.ui.recording

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.local.TokenManager
import com.kreativekoala.summaryai.service.AudioRecordingService
import com.kreativekoala.summaryai.service.LiveSpeechRecognizer
import com.kreativekoala.summaryai.service.RecordingState
import com.kreativekoala.summaryai.service.UploadState
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class RecordingUiState(
    val recordingState: RecordingState = RecordingState(),
    val title: String = "",
    val isUploading: Boolean = false,
    val uploadProgress: Float = 0f,
    val uploadedRecordingId: String? = null,
    val error: String? = null,
    val liveTranscribeEnabled: Boolean = false,
    val liveTranscript: String = "",
    val liveTranscribeError: String? = null
)

@HiltViewModel
class RecordingViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val tokenManager: TokenManager,
    private val liveSpeech: LiveSpeechRecognizer
) : ViewModel() {

    private val isDemoMode: Boolean
        get() = tokenManager.userId?.startsWith("demo-user-") == true

    private val _uiState = MutableStateFlow(RecordingUiState())
    val uiState: StateFlow<RecordingUiState> = _uiState.asStateFlow()

    private var recordingService: AudioRecordingService? = null
    private var isBound = false
    private var recordingObserverJob: Job? = null
    private var uploadObserverJob: Job? = null

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as AudioRecordingService.RecordingBinder
            recordingService = binder.getService()
            isBound = true

            recordingObserverJob?.cancel()
            recordingObserverJob = viewModelScope.launch {
                recordingService?.recordingState?.collect { state ->
                    _uiState.value = _uiState.value.copy(recordingState = state)
                    syncLiveTranscribe()
                }
            }

            uploadObserverJob?.cancel()
            uploadObserverJob = viewModelScope.launch {
                recordingService?.uploadState?.collect { state -> applyUploadState(state) }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            recordingService = null
            isBound = false
        }
    }

    init {
        bindService()
        // Mirror live-speech state into the UI.
        viewModelScope.launch {
            liveSpeech.transcript.collect { text ->
                _uiState.value = _uiState.value.copy(liveTranscript = text)
            }
        }
        viewModelScope.launch {
            liveSpeech.errorMessage.collect { err ->
                _uiState.value = _uiState.value.copy(liveTranscribeError = err)
            }
        }
    }

    /** Toggle live transcription. Starts recognizer if recording is active. */
    fun setLiveTranscribeEnabled(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(liveTranscribeEnabled = enabled)
        syncLiveTranscribe()
    }

    private fun syncLiveTranscribe() {
        val state = _uiState.value
        val shouldRun = state.liveTranscribeEnabled && state.recordingState.isRecording && !state.recordingState.isPaused
        if (shouldRun && !liveSpeech.isRunning.value) {
            liveSpeech.start(languageTag = null)
        } else if (!shouldRun && liveSpeech.isRunning.value) {
            liveSpeech.stop()
        }
    }

    private fun bindService() {
        val intent = Intent(context, AudioRecordingService::class.java)
        context.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    fun updateTitle(title: String) {
        _uiState.value = _uiState.value.copy(title = title)
    }

    fun startRecording() {
        val intent = Intent(context, AudioRecordingService::class.java).apply {
            action = AudioRecordingService.ACTION_START
        }
        context.startForegroundService(intent)
    }

    fun pauseRecording() {
        val intent = Intent(context, AudioRecordingService::class.java).apply {
            action = AudioRecordingService.ACTION_PAUSE
        }
        context.startService(intent)
    }

    fun resumeRecording() {
        val intent = Intent(context, AudioRecordingService::class.java).apply {
            action = AudioRecordingService.ACTION_RESUME
        }
        context.startService(intent)
    }

    fun stopAndUpload() {
        if (isDemoMode) {
            recordingService?.discardRecording()
            _uiState.value = _uiState.value.copy(error = context.getString(R.string.demo_mode_message))
            return
        }

        val service = recordingService
        if (service == null) {
            _uiState.value = _uiState.value.copy(
                error = context.getString(R.string.error_recording_file_not_found)
            )
            return
        }

        val title = _uiState.value.title.ifBlank { context.getString(R.string.untitled_recording) }
        val duration = _uiState.value.recordingState.durationSeconds

        val outputFile = service.stopRecording()
        if (outputFile != null && outputFile.exists()) {
            // Hand off to the service so the upload survives Activity death.
            service.startUpload(outputFile, title, duration)
        } else {
            service.discardRecording()
            _uiState.value = _uiState.value.copy(
                error = context.getString(R.string.error_recording_file_not_found)
            )
        }
    }

    fun cancel() {
        recordingService?.discardRecording()
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    private fun applyUploadState(state: UploadState) {
        _uiState.value = _uiState.value.copy(
            isUploading = state.isUploading,
            uploadProgress = state.progress,
            uploadedRecordingId = state.uploadedRecordingId ?: _uiState.value.uploadedRecordingId,
            error = state.error ?: _uiState.value.error
        )
    }

    override fun onCleared() {
        super.onCleared()
        if (isBound) {
            context.unbindService(serviceConnection)
            isBound = false
        }
        liveSpeech.stop()
    }
}
