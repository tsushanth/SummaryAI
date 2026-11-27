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
import com.kreativekoala.summaryai.data.local.TokenManager
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.service.activation.RecordStepNames
import com.kreativekoala.summaryai.service.activation.RecordSteps
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
        const val EXTRA_AUTOMATIC = "extra_automatic"

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

        /** Which files this process is writing or sending right now. Lost with the process, which is what makes them "pending". */
        internal val busyFiles = BusyRecordingFiles()

        /** Returns audio files that finished recording but haven't been uploaded. */
        fun listPendingUploads(context: Context): List<File> {
            val files = recordingsDir(context)
                .listFiles { f -> f.isFile && f.name.endsWith(".m4a") }
                ?.sortedByDescending { it.lastModified() }
                ?: emptyList()
            return busyFiles.pendingAmong(files)
        }

        /**
         * A recording to send again by itself now, or null (nothing due, or a recording or upload is running). The file
         * counts as being uploaded from here on; start it with [EXTRA_AUTOMATIC], or call [abandonAutomaticRetry].
         */
        internal fun claimAutomaticRetry(context: Context, userId: String?): AutomaticUploadRetry.Claim? {
            if (busyFiles.recording != null || busyFiles.uploading != null) return null
            return AutomaticUploadRetry.claim(listPendingUploads(context), userId, System.currentTimeMillis())
                ?.also { busyFiles.uploading = it.file }
        }

        /** The system refused to start the upload: leave the recording due for a later try. */
        internal fun abandonAutomaticRetry(claim: AutomaticUploadRetry.Claim) {
            claim.undo()
            busyFiles.finishedUploading(claim.file)
        }
    }

    @Inject lateinit var recordingsRepository: RecordingsRepository
    @Inject lateinit var tokenManager: TokenManager

    private val binder = RecordingBinder()
    private var mediaRecorder: MediaRecorder? = null
    private var timerJob: Job? = null
    private var amplitudeJob: Job? = null
    private var uploadJob: Job? = null

    private var peakLevel = 0
    private var levelSamples = 0

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
                val title = intent.getStringExtra(EXTRA_TITLE) ?: getString(R.string.recording_fallback)
                val duration = intent.getIntExtra(EXTRA_DURATION, 0)
                if (path != null) {
                    startUpload(File(path), title, duration, intent.getBooleanExtra(EXTRA_AUTOMATIC, false))
                }
            }
        }
        return START_NOT_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notif_channel_recording_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.notif_channel_recording_description)
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
            .setContentTitle(getString(if (state.isPaused) R.string.notif_recording_paused else R.string.recording_fallback))
            .setContentText(duration)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .addAction(
                R.drawable.ic_launcher_foreground,
                getString(if (state.isPaused) R.string.notif_action_resume else R.string.pause),
                pauseResumeIntent
            )
            .addAction(R.drawable.ic_launcher_foreground, getString(R.string.notif_action_stop), stopIntent)
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
            .setContentTitle(getString(R.string.notif_uploading_recording))
            .setContentText(getString(R.string.notif_uploading_keep_open, progressPercent))
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

            busyFiles.recording = outputFile
            peakLevel = 0
            levelSamples = 0
            startForegroundAs(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE, createRecordingNotification())
            startTimer()
            startAmplitudeMonitor()
        } catch (e: Exception) {
            _recordingState.value = _recordingState.value.copy(
                error = getString(R.string.recording_error_start, e.message)
            )
            RecordSteps.step("start_failed")
            com.kreativekoala.summaryai.FailureReporter.failure(
                flow = "recording_start",
                t = e,
                message = "Recording did not start: ${e.javaClass.simpleName}", // i18n-ok
            )
            stopSelf()
        }
    }

    /**
     * The user chose "Record again": the held recording is replaced by a new one. The service stays in the
     * foreground, so this is the only path that deletes a recording without stopping.
     */
    fun restartRecording() {
        timerJob?.cancel()
        amplitudeJob?.cancel()
        val old = _recordingState.value.outputFile
        mediaRecorder?.apply {
            runCatching { stop() }
            release()
        }
        mediaRecorder = null
        busyFiles.recording = null
        old?.let {
            it.delete()
            PendingUploadMeta.fileFor(it).delete()
        }
        _recordingState.value = RecordingState()
        startRecording()
    }

    /** Loudest level of the recording in progress (0..32767), or null when it was never measured. */
    fun peakAmplitude(): Int? {
        readLevel()
        return peakLevel.takeIf { levelSamples >= RecordingCheck.MIN_LEVEL_SAMPLES }
    }

    /** MediaRecorder reports the loudest level since the previous read, so no sound is missed between reads. */
    private fun readLevel(): Int? = runCatching { mediaRecorder?.maxAmplitude }.getOrNull()?.also {
        peakLevel = maxOf(peakLevel, it)
        levelSamples++
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
                    error = getString(R.string.recording_error_pause, e.message)
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
                    error = getString(R.string.recording_error_resume, e.message)
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
        busyFiles.recording = null
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
        busyFiles.recording = null
        file?.let {
            it.delete()
            PendingUploadMeta.fileFor(it).delete()
        }
        _recordingState.value = RecordingState()
        _uploadState.value = UploadState()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * Uploads the given recording file. Persists title+duration to a sidecar
     * meta file so the upload can be retried after a crash. Switches the
     * foreground service type to DATA_SYNC for the duration of the upload.
     *
     * An [automatic] retry shows only the notification: it never takes over the Record screen with progress, an error or
     * a jump to the finished recording.
     */
    fun startUpload(file: File, title: String, durationSeconds: Int, automatic: Boolean = false) {
        // Never while recording: the file being written would change length mid-upload, and switching the service to
        // DATA_SYNC (then stopping it) would end the recording. The file stays on disk and is offered again later.
        if (mediaRecorder != null) {
            Log.w(TAG, "Upload refused while a recording is in progress")
            busyFiles.finishedUploading(file)
            return
        }
        if (!file.exists()) {
            _uploadState.value = UploadState(error = getString(R.string.error_recording_file_not_found))
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }

        val previous = PendingUploadMeta.read(file)
        // Not due again until this attempt fails: if the process dies mid-upload the audio may already be on the server.
        val meta = PendingUploadMeta(
            title = title,
            durationSeconds = durationSeconds,
            owner = if (automatic) previous.owner else tokenManager.userId,
            automaticAttempts = if (automatic) previous.automaticAttempts else 0,
        )
        meta.writeFor(file)

        if (!automatic) _uploadState.value = UploadState(isUploading = true, progress = 0f, file = file)
        startForegroundAs(ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC, createUploadNotification(0))

        uploadJob?.cancel()
        busyFiles.uploading = file
        uploadJob = scope.launch(Dispatchers.IO) {
            var lastPct = -1
            var retryLater = false
            val result = runCatching {
                recordingsRepository.uploadRecording(
                    title = title,
                    audioFile = file,
                    durationSeconds = durationSeconds,
                    onRetryableFailure = { retryLater = true },
                    onProgress = { progress ->
                        val pct = (progress * 100).toInt().coerceIn(0, 100)
                        if (pct != lastPct) {
                            lastPct = pct
                            if (!automatic) _uploadState.value = _uploadState.value.copy(progress = progress)
                            // A recording started during an automatic retry owns the notification.
                            if (mediaRecorder == null) updateNotification(createUploadNotification(pct))
                        }
                    }
                )
            }.getOrElse { Result.failure(it) }

            RecordSteps.track(
                RecordStepNames.DONE,
                "ok" to result.isSuccess,
                "seconds" to durationSeconds,
                "auto" to automatic,
            )

            result.fold(
                onSuccess = { recording ->
                    if (!automatic) {
                        _uploadState.value = UploadState(
                            isUploading = false,
                            progress = 1f,
                            uploadedRecordingId = recording.id
                        )
                    }
                    file.delete()
                    PendingUploadMeta.fileFor(file).delete()
                },
                onFailure = { error ->
                    Log.e(TAG, "Upload failed, file retained for retry: ${file.absolutePath}", error)
                    // Intentionally keep the file + meta sidecar for retry
                    if (retryLater) {
                        meta.copy(retryAutomatically = true, lastFailureMs = System.currentTimeMillis()).writeFor(file)
                    }
                    if (!automatic) {
                        _uploadState.value = UploadState(
                            isUploading = false,
                            file = file,
                            error = error.message ?: getString(R.string.recording_upload_failed_default)
                        )
                    }
                }
            )
            busyFiles.finishedUploading(file)
            // A new recording or a later upload may have started while this one ran: it now owns the foreground service.
            if (mediaRecorder == null && busyFiles.uploading == null) {
                ServiceCompat.stopForeground(this@AudioRecordingService, ServiceCompat.STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
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
                    val amplitude = readLevel() ?: 0
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
        busyFiles.recording = null
        // Note: don't cancel uploadJob here — onDestroy can fire briefly when the
        // last bind is removed. The upload coroutine completes stopSelf() itself.
    }
}
