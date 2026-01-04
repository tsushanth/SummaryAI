package com.kreativekoala.summaryai.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.os.Binder
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.kreativekoala.summaryai.MainActivity
import com.kreativekoala.summaryai.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
 * Foreground service for audio recording
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
        private const val MAX_AMPLITUDES = 50
    }

    private val binder = RecordingBinder()
    private var mediaRecorder: MediaRecorder? = null
    private var timerJob: Job? = null
    private var amplitudeJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    private val _recordingState = MutableStateFlow(RecordingState())
    val recordingState: StateFlow<RecordingState> = _recordingState.asStateFlow()

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
                description = "Shows when recording is in progress"
                setShowBadge(false)
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
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
            .setSmallIcon(R.drawable.ic_launcher_foreground) // Use proper icon
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

            startForeground(NOTIFICATION_ID, createNotification())
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
                updateNotification()
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
                updateNotification()
            } catch (e: Exception) {
                _recordingState.value = _recordingState.value.copy(
                    error = "Failed to resume: ${e.message}"
                )
            }
        }
    }

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
        }

        mediaRecorder = null

        _recordingState.value = RecordingState()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()

        return outputFile
    }

    private fun startTimer() {
        timerJob = scope.launch {
            while (isActive) {
                delay(1000)
                _recordingState.value = _recordingState.value.copy(
                    durationSeconds = _recordingState.value.durationSeconds + 1
                )
                updateNotification()
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

    private fun updateNotification() {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID, createNotification())
    }

    private fun createOutputFile(): File {
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val fileName = "recording_$timestamp.m4a"
        val directory = File(cacheDir, "recordings")
        if (!directory.exists()) {
            directory.mkdirs()
        }
        return File(directory, fileName)
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
    }
}
