package com.kreativekoala.summaryai.service

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "LiveSpeechRecognizer"

/**
 * Continuous on-device live speech recognition. Mirrors the iOS feature
 * (SFSpeechRecognizer) — turns the device microphone into a streaming
 * transcript while a recording is in progress.
 *
 * Implementation notes:
 *  - On API 33+ uses [SpeechRecognizer.createOnDeviceSpeechRecognizer] so
 *    the audio never leaves the device and there's no usage cost.
 *  - On API 31-32 falls back to the regular network recognizer (which has
 *    its own quotas).
 *  - Android's recognizer has a built-in silence-timeout — it stops on its
 *    own after a pause. To get continuous behaviour we restart it inside
 *    [onResults] and [onError] (for transient errors).
 *  - This shares the microphone with [AudioRecordingService]'s MediaRecorder.
 *    AudioFlinger arbitrates; on most devices both work simultaneously.
 */
@Singleton
class LiveSpeechRecognizer @Inject constructor(
    @ApplicationContext private val context: Context
) {

    private val _transcript = MutableStateFlow("")
    val transcript: StateFlow<String> = _transcript.asStateFlow()

    private val _isRunning = MutableStateFlow(false)
    val isRunning: StateFlow<Boolean> = _isRunning.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private var recognizer: SpeechRecognizer? = null
    private var currentLanguage: String = "en-US"
    /** Accumulated final transcripts. Partials sit on top of this for display. */
    private var accumulated: String = ""
    /** Set to false in [stop] so the auto-restart loop knows to bail. */
    private var shouldKeepListening: Boolean = false
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var restartJob: Job? = null

    /** True if the device supports on-device recognition (Android 13+). */
    val supportsOnDevice: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    /**
     * Start continuous recognition. [languageTag] is BCP-47 ("en-US", "es-ES",
     * etc.) — pass null to use the device default.
     */
    fun start(languageTag: String? = null) {
        if (_isRunning.value) stop()
        accumulated = ""
        _transcript.value = ""
        _errorMessage.value = null
        currentLanguage = languageTag ?: java.util.Locale.getDefault().toLanguageTag()
        shouldKeepListening = true
        _isRunning.value = true
        beginRecognition()
    }

    fun stop() {
        shouldKeepListening = false
        restartJob?.cancel()
        recognizer?.apply {
            runCatching { stopListening() }
            runCatching { destroy() }
        }
        recognizer = null
        _isRunning.value = false
    }

    private fun beginRecognition() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            _errorMessage.value = "Speech recognition is not available on this device"
            shouldKeepListening = false
            _isRunning.value = false
            return
        }

        // Build a fresh recognizer for each session; recycling them sometimes
        // causes the listener to receive stale callbacks on certain devices.
        recognizer = if (supportsOnDevice) {
            Log.d(TAG, "Using on-device recognizer for $currentLanguage")
            SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
        } else {
            Log.d(TAG, "Using network recognizer for $currentLanguage (on-device unavailable)")
            SpeechRecognizer.createSpeechRecognizer(context)
        }

        recognizer?.setRecognitionListener(listener)

        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, currentLanguage)
            // Prefer offline when we can (the on-device recognizer is already
            // offline; this hints the network recognizer to do the same).
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }

        runCatching { recognizer?.startListening(intent) }
            .onFailure {
                Log.e(TAG, "startListening failed", it)
                _errorMessage.value = it.localizedMessage
                shouldKeepListening = false
                _isRunning.value = false
            }
    }

    /**
     * Restart the recognizer after a natural stop (silence) or recoverable
     * error. Small delay because some devices throw if we call
     * startListening too fast on the same recognizer instance.
     */
    private fun scheduleRestart(delayMs: Long = 150) {
        if (!shouldKeepListening) return
        restartJob?.cancel()
        restartJob = scope.launch {
            kotlinx.coroutines.delay(delayMs)
            if (shouldKeepListening) beginRecognition()
        }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            val partial = partialResults
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()
            Log.d(TAG, "onPartialResults: '${partial.take(60)}'")
            if (partial.isNotEmpty()) {
                _transcript.value = (accumulated + " " + partial).trim()
            }
        }

        override fun onResults(results: Bundle?) {
            val final = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                .orEmpty()
            Log.d(TAG, "onResults (final): '${final.take(60)}'")
            if (final.isNotEmpty()) {
                accumulated = (accumulated + " " + final).trim()
                _transcript.value = accumulated
            }
            // Continuous mode: kick off another listening session.
            scheduleRestart()
        }

        override fun onError(error: Int) {
            val description = errorDescription(error)
            Log.w(TAG, "Recognition error $error: $description")
            when (error) {
                // Recoverable / expected during normal use — just restart.
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> scheduleRestart(delayMs = 300)

                // Real failure — surface and stop.
                else -> {
                    _errorMessage.value = description
                    shouldKeepListening = false
                    _isRunning.value = false
                }
            }
        }
    }

    private fun errorDescription(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
        SpeechRecognizer.ERROR_CLIENT -> "Client side error"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission denied"
        SpeechRecognizer.ERROR_NETWORK -> "Network error"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
        SpeechRecognizer.ERROR_NO_MATCH -> "No match"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
        SpeechRecognizer.ERROR_SERVER -> "Server error"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech input"
        else -> "Unknown error $code"
    }
}
