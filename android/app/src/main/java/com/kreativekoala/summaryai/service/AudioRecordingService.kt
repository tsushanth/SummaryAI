package com.kreativekoala.summaryai.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.MediaRecorder
import android.os.Binder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.kreativekoala.summaryai.MainActivity
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

private const val TAG = "AudioRecordingService"

/**
 * Recording state
 */
data class RecordingState(
    val isRecording: Boolean = false,
    val isPaused: Boolean = false,
    val durationSeconds: Int = 0,
    val amplitudes: List<Float> = emptyList(),
    val outputFile: File? = null,
    val error: String? = null
)

/**
 * Upload state, exposed independently so the recording screen can show progress
 * even though the upload now runs in the service (surviving Activity destruction).
 */
data class UploadState(
    val isUploading: Boolean = false,
    val progress: Float = 0f,
    val file: File? = null,
    val uploadedRecordingId: String? = null,
    val error: String? = null
)

/**
 * Foreground service for audio recording and upload.
 *
 * The same service handles the upload phase so it survives Activity destruction
 * (screen off, app backgrounded, ViewModel cleared). The foreground type
 * transitions from MICROPHONE → DATA_SYNC after recording stops.
 */
@AndroidEntryPoint
class AudioRecordingService : Service() {

    companion object {
        const val CHANNEL_ID = "recording_channel"
        const val NOTIFICATION_ID = 1
        const val ACTION_START = "com.kreativekoala.summaryai.action.START_RECORDING"
        const val ACTION_STOP = "com.kreativekoala.summaryai.action.STOP_RECORDING"
        const val ACTION_PAUSE = "com.kreativekoala.summaryai.action.PAUSE_RECORDING"
        const val ACTION_RESUME = "com.kreativekoala.summaryai.action.RESUME_RECORDING"
        const val ACTION_UPLOAD = "com.kreativekoala.summaryai.action.UPLOAD_RECORDING"
        const val EXTRA_FILE_PATH = "extra_file_path"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_DURATION = "extra_duration"

        private const val MAX_AMPLITUDES = 50

        /**
         * Persistent location for in-progress and pending-retry recordings.
         * Lives in filesDir (not cacheDir) so Android won't purge it under
         * storage pressure.
         */
        fun recordingsDir(context: Context): File {
            val dir = File(context.filesDir, "recordings")
            if (!dir.exists()) dir.mkdirs()
            return dir
        }

        /** Returns audio files that finished recording but haven't been uploaded. */
        fun listPendingUploads(context: Context): List<File> {
            return recordingsDir(context)
                .listFiles { f -> f.isFile && f.name.endsWith(".m4a") }
                ?.sortedByDescending { it.lastModified() }
                ?: emptyList()
        }
    }

    @Inject lateinit var recordingsRepository: RecordingsRepository

    private val binder = RecordingBinder()
    private var mediaRecorder: MediaRecorder? = null
    private var timerJob: Job? = null
    private var amplitudeJob: Job? = null
    private var uploadJob: Job? = null

    // SupervisorJob so a failed upload doesn't take down the timer scope
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    private val _recordingState = MutableStateFlow(RecordingState())
    val recordingState: StateFlow<RecordingState> = _recordingState.asStateFlow()

    private val _uploadState = MutableStateFlow(UploadState())
    val uploadState: StateFlow<UploadState> = _uploadState.asStateFlow()

    inner class RecordingBinder : Binder() {
        fun getService(): AudioRecordingService = this@AudioRecordingService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startRecording()
            ACTION_STOP -> stopRecording()
            ACTION_PAUSE -> pauseRecording()
            ACTION_RESUME -> resumeRecording()
            ACTION_UPLOAD -> {
                val path = intent.getStringExtra(EXTRA_FILE_PATH)
                val title = intent.getStringExtra(EXTRA_TITLE) ?: "Recording"
                val duration = intent.getIntExtra(EXTRA_DURATION, 0)
                if (path != null) {
                    startUpload(File(path), title, duration)
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Recording",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when recording or uploading is in progress"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createRecordingNotification(): Notification {
        val state = _recordingState.value
        val duration = formatDuration(state.durationSeconds)

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = PendingIntent.getService(
            this,
            0,
            Intent(this, AudioRecordingService::class.java).apply {
                action = ACTION_STOP
            },
            PendingIntent.FLAG_IMMUTABLE
        )

        val pauseResumeIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, AudioRecordingService::class.java).apply {
                action = if (state.isPaused) ACTION_RESUME else ACTION_PAUSE
            },
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(if (state.isPaused) "Recording Paused" else "Recording")
            .setContentText(duration)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .addAction(
                R.drawable.ic_launcher_foreground,
                if (state.isPaused) "Resume" else "Pause",
                pauseResumeIntent
            )
            .addAction(R.drawable.ic_launcher_foreground, "Stop", stopIntent)
            .build()
    }

    private fun createUploadNotification(progressPercent: Int): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Uploading recording")
            .setContentText("$progressPercent% — keep the app open until upload finishes")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setProgress(100, progressPercent, progressPercent == 0)
            .build()
    }

    fun startRecording() {
        try {
            val outputFile = createOutputFile()

            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(this)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(44100)
                setAudioEncodingBitRate(128000)
                setOutputFile(outputFile.absolutePath)
                prepare()
                start()
            }

            _recordingState.value = RecordingState(
                isRecording = true,
                isPaused = false,
                durationSeconds = 0,
                amplitudes = emptyList(),
                outputFile = outputFile
            )

            startForegroundAs(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE, createRecordingNotification())
            startTimer()
            startAmplitudeMonitor()
        } catch (e: Exception) {
            _recordingState.value = _recordingState.value.copy(
                error = "Failed to start recording: ${e.message}"
            )
            stopSelf()
        }
    }

    fun pauseRecording() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                mediaRecorder?.pause()
                _recordingState.value = _recordingState.value.copy(isPaused = true)
                timerJob?.cancel()
                amplitudeJob?.cancel()
                updateNotification(createRecordingNotification())
            } catch (e: Exception) {
                _recordingState.value = _recordingState.value.copy(
                    error = "Failed to pause: ${e.message}"
                )
            }
        }
    }

    fun resumeRecording() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            try {
                mediaRecorder?.resume()
                _recordingState.value = _recordingState.value.copy(isPaused = false)
                startTimer()
                startAmplitudeMonitor()
                updateNotification(createRecordingNotification())
            } catch (e: Exception) {
                _recordingState.value = _recordingState.value.copy(
                    error = "Failed to resume: ${e.message}"
                )
            }
        }
    }

    /**
     * Stops the recording and returns the output file. Does NOT stop the service —
     * the caller must follow up with [startUpload] or [discardRecording] so the
     * foreground service stays alive across the upload phase.
     */
    fun stopRecording(): File? {
        timerJob?.cancel()
        amplitudeJob?.cancel()

        val outputFile = _recordingState.value.outputFile

        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
        } catch (e: Exception) {
            // Recording might have been too short
            Log.w(TAG, "Error stopping MediaRecorder", e)
        }

        mediaRecorder = null
        _recordingState.value = RecordingState()
        // Note: foreground state is intentionally kept so caller can start upload.
        // If neither startUpload nor discardRecording is called, the service will
        // be killed by Android due to type-mismatch (microphone declared but no
        // mic active). Callers must follow up.
        return outputFile
    }

    /** Drops the in-progress recording entirely and stops the service. */
    fun discardRecording() {
        val file = _recordingState.value.outputFile
        try {
            mediaRecorder?.apply {
                runCatching { stop() }
                release()
            }
        } catch (_: Exception) { /* ignore */ }
        mediaRecorder = null
        file?.delete()
        metaFileFor(file)?.delete()
        _recordingState.value = RecordingState()
        _uploadState.value = UploadState()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * Uploads the given recording file. Persists title+duration to a sidecar
     * meta file so the upload can be retried after a crash. Switches the
     * foreground service type to DATA_SYNC for the duration of the upload.
     */
    fun startUpload(file: File, title: String, durationSeconds: Int) {
        if (!file.exists()) {
            _uploadState.value = UploadState(error = "Recording file not found")
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        writeMetaFile(file, title, durationSeconds)

        _uploadState.value = UploadState(isUploading = true, progress = 0f, file = file)
        startForegroundAs(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC, createUploadNotification(0))

        uploadJob?.cancel()
        uploadJob = scope.launch(Dispatchers.IO) {
            var lastPct = -1
            val result = runCatching {
                recordingsRepository.uploadRecording(
                    title = title,
                    audioFile = file,
                    durationSeconds = durationSeconds,
                    onProgress = { progress ->
                        val pct = (progress * 100).toInt().coerceIn(0, 100)
                        if (pct != lastPct) {
                            lastPct = pct
                            _uploadState.value = _uploadState.value.copy(progress = progress)
                            updateNotification(createUploadNotification(pct))
                        }
                    }
                )
            }.getOrElse { Result.failure(it) }

            result.fold(
                onSuccess = { recording ->
                    _uploadState.value = UploadState(
                        isUploading = false,
                        progress = 1f,
                        uploadedRecordingId = recording.id
                    )
                    file.delete()
                    metaFileFor(file)?.delete()
                },
                onFailure = { error ->
                    Log.e(TAG, "Upload failed, file retained for retry: ${file.absolutePath}", error)
                    _uploadState.value = UploadState(
                        isUploading = false,
                        file = file,
                        error = error.message ?: "Upload failed"
                    )
                    // Intentionally keep the file + meta sidecar for retry
                }
            )
            ServiceCompat.stopForeground(this@AudioRecordingService, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    fun clearUploadState() {
        _uploadState.value = UploadState()
    }

    private fun startTimer() {
        timerJob = scope.launch {
            while (isActive) {
                delay(1000)
                _recordingState.value = _recordingState.value.copy(
                    durationSeconds = _recordingState.value.durationSeconds + 1
                )
                updateNotification(createRecordingNotification())
            }
        }
    }

    private fun startAmplitudeMonitor() {
        amplitudeJob = scope.launch {
            while (isActive) {
                delay(100)
                try {
                    val amplitude = mediaRecorder?.maxAmplitude ?: 0
                    val normalized = (amplitude.toFloat() / 32767f).coerceIn(0f, 1f)

                    val currentAmplitudes = _recordingState.value.amplitudes.toMutableList()
                    currentAmplitudes.add(normalized)
                    if (currentAmplitudes.size > MAX_AMPLITUDES) {
                        currentAmplitudes.removeAt(0)
                    }

                    _recordingState.value = _recordingState.value.copy(
                        amplitudes = currentAmplitudes
                    )
                } catch (e: Exception) {
                    // Ignore amplitude errors
                }
            }
        }
    }

    private fun startForegroundAs(type: Int, notification: Notification) {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    }

    private fun updateNotification(notification: Notification) {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    private fun createOutputFile(): File {
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val fileName = "recording_$timestamp.m4a"
        return File(recordingsDir(this), fileName)
    }

    private fun writeMetaFile(audio: File, title: String, durationSeconds: Int) {
        runCatching {
            metaFileFor(audio)?.writeText(
                "title=$title\nduration=$durationSeconds\n"
            )
        }
    }

    private fun metaFileFor(audio: File?): File? {
        if (audio == null) return null
        return File(audio.parentFile, audio.nameWithoutExtension + ".meta")
    }

    private fun formatDuration(seconds: Int): String {
        val hours = seconds / 3600
        val minutes = (seconds % 3600) / 60
        val secs = seconds % 60

        return if (hours > 0) {
            String.format("%d:%02d:%02d", hours, minutes, secs)
        } else {
            String.format("%d:%02d", minutes, secs)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        timerJob?.cancel()
        amplitudeJob?.cancel()
        mediaRecorder?.release()
        mediaRecorder = null
        // Note: don't cancel uploadJob here — onDestroy can fire briefly when the
        // last bind is removed. The upload coroutine completes stopSelf() itself.
    }
}
