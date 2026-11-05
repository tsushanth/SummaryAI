package com.kreativekoala.summaryai.service.voice

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.Locale
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

sealed interface ListenResult {
    data class Heard(val text: String, val onDevice: Boolean, val durationMs: Long) : ListenResult
    data object Silence : ListenResult
    data object PermissionDenied : ListenResult
    data object Unavailable : ListenResult
    data class Failed(val code: Int) : ListenResult
}

/**
 * One utterance at a time from the system recognizer. On Android 13+ it asks for the on-device recognizer, so the
 * audio stays on the phone; older versions fall back to the system's default recognizer (which may use the network).
 * Must be called on the main thread. Recognised text is returned to the caller only; it is never logged here.
 */
@Singleton
class AndroidSpeechInput @Inject constructor(@ApplicationContext private val context: Context) {

    private var recognizer: SpeechRecognizer? = null

    val onDeviceAvailable: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    suspend fun listenOnce(languageTag: String = Locale.getDefault().toLanguageTag()): ListenResult {
        if (!SpeechRecognizer.isRecognitionAvailable(context) && !onDeviceAvailable) return ListenResult.Unavailable
        cancel()
        val useOnDevice = onDeviceAvailable
        val sr = if (useOnDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = sr
        val started = System.currentTimeMillis()
        return suspendCancellableCoroutine { cont ->
            sr.setRecognitionListener(object : RecognitionListener {
                override fun onResults(results: Bundle?) {
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                    release(sr)
                    if (cont.isActive) cont.resume(if (text.isBlank()) ListenResult.Silence else ListenResult.Heard(text, useOnDevice, System.currentTimeMillis() - started))
                }

                override fun onError(error: Int) {
                    release(sr)
                    val r = when (error) {
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> ListenResult.Silence
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> ListenResult.PermissionDenied
                        else -> ListenResult.Failed(error)
                    }
                    if (cont.isActive) cont.resume(r)
                }

                override fun onReadyForSpeech(params: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
            }
            sr.startListening(intent)
            cont.invokeOnCancellation { release(sr) }
        }
    }

    fun cancel() {
        recognizer?.let { release(it) }
    }

    private fun release(sr: SpeechRecognizer) {
        runCatching { sr.cancel() }
        runCatching { sr.destroy() }
        if (recognizer === sr) recognizer = null
    }
}

/** Reads text aloud with the system's text-to-speech engine and returns when the sentence has finished or was stopped. */
@Singleton
class AndroidSpeechOutput @Inject constructor(@ApplicationContext private val context: Context) {

    private var tts: TextToSpeech? = null
    private var ready = false

    private suspend fun engine(): TextToSpeech? {
        tts?.let { return if (ready) it else null }
        return suspendCancellableCoroutine { cont ->
            var created: TextToSpeech? = null
            created = TextToSpeech(context.applicationContext) { status ->
                ready = status == TextToSpeech.SUCCESS
                if (ready) created?.language = Locale.getDefault()
                if (cont.isActive) cont.resume(if (ready) created else null)
            }
            tts = created
        }
    }

    /** Returns false when no engine is available; the text is still shown on screen. */
    suspend fun speak(text: String): Boolean {
        if (text.isBlank()) return true
        val engine = engine() ?: return false
        val id = UUID.randomUUID().toString()
        return suspendCancellableCoroutine { cont ->
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) { if (utteranceId == id && cont.isActive) cont.resume(true) }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) { if (utteranceId == id && cont.isActive) cont.resume(false) }
                override fun onStop(utteranceId: String?, interrupted: Boolean) { if (utteranceId == id && cont.isActive) cont.resume(true) }
            })
            val rc = engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
            if (rc != TextToSpeech.SUCCESS && cont.isActive) cont.resume(false)
            cont.invokeOnCancellation { runCatching { engine.stop() } }
        }
    }

    fun stop() {
        runCatching { tts?.stop() }
    }

    fun shutdown() {
        runCatching { tts?.stop() }
        runCatching { tts?.shutdown() }
        tts = null
        ready = false
    }
}

object AudioRoute {
    /** True when sound would come out of the phone's own speaker (no headset, wired or Bluetooth output connected). */
    fun isLoudspeaker(context: Context): Boolean {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return true
        val private = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
            when (it.type) {
                AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_BLE_HEADSET -> true
                else -> false
            }
        }
        return !private
    }
}
