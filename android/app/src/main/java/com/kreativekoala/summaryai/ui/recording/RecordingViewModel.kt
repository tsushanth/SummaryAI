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
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.service.AudioRecordingService
import com.kreativekoala.summaryai.service.RecordingState
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

data class RecordingUiState(
    val recordingState: RecordingState = RecordingState(),
    val title: String = "",
    val isUploading: Boolean = false,
    val uploadProgress: Float = 0f,
    val uploadedRecordingId: String? = null,
    val error: String? = null
)

// DEMO_MODE_MESSAGE moved to string resource R.string.demo_mode_message

@HiltViewModel
class RecordingViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val recordingsRepository: RecordingsRepository,
    private val tokenManager: TokenManager
) : ViewModel() {

    private val isDemoMode: Boolean
        get() = tokenManager.userId?.startsWith("demo-user-") == true

    private val _uiState = MutableStateFlow(RecordingUiState())
    val uiState: StateFlow<RecordingUiState> = _uiState.asStateFlow()

    private var recordingService: AudioRecordingService? = null
    private var isBound = false

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as AudioRecordingService.RecordingBinder
            recordingService = binder.getService()
            isBound = true

            // Observe recording state
            viewModelScope.launch {
                recordingService?.recordingState?.collect { state ->
                    _uiState.value = _uiState.value.copy(recordingState = state)
                }
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            recordingService = null
            isBound = false
        }
    }

    init {
        bindService()
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
            recordingService?.stopRecording()
            _uiState.value = _uiState.value.copy(error = context.getString(R.string.demo_mode_message))
            return
        }

        viewModelScope.launch {
            val outputFile = recordingService?.stopRecording()

            if (outputFile != null && outputFile.exists()) {
                uploadRecording(outputFile)
            } else {
                _uiState.value = _uiState.value.copy(
                    error = context.getString(R.string.error_recording_file_not_found)
                )
            }
        }
    }

    fun cancel() {
        recordingService?.stopRecording()
        // Delete the file if it exists
        _uiState.value.recordingState.outputFile?.delete()
    }

    private suspend fun uploadRecording(file: File) {
        _uiState.value = _uiState.value.copy(isUploading = true, uploadProgress = 0f)

        val title = _uiState.value.title.ifBlank { context.getString(R.string.untitled_recording) }
        val duration = _uiState.value.recordingState.durationSeconds

        val result = recordingsRepository.uploadRecording(
            title = title,
            audioFile = file,
            durationSeconds = duration,
            onProgress = { progress ->
                _uiState.value = _uiState.value.copy(uploadProgress = progress)
            }
        )

        result.fold(
            onSuccess = { recording ->
                _uiState.value = _uiState.value.copy(
                    isUploading = false,
                    uploadedRecordingId = recording.id
                )
                // Clean up temp file
                file.delete()
            },
            onFailure = { error ->
                _uiState.value = _uiState.value.copy(
                    isUploading = false,
                    error = error.message ?: context.getString(R.string.error_upload_failed)
                )
            }
        )
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        if (isBound) {
            context.unbindService(serviceConnection)
            isBound = false
        }
    }
}
