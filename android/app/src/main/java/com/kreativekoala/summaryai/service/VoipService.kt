package com.kreativekoala.summaryai.service

import android.content.Context
import android.media.AudioManager
import android.util.Log
import androidx.annotation.StringRes
import com.kreativekoala.summaryai.FailureReporter
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.repository.PhoneRepository
import com.twilio.voice.Call
import com.twilio.voice.CallException
import com.twilio.voice.ConnectOptions
import com.twilio.voice.Voice
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/** Why a call ended, as far as the app's own leg can tell. */
enum class CallEndReason(@StringRes val messageRes: Int) {
    COMPLETED(R.string.call_end_completed),
    BUSY(R.string.call_end_busy),
    CANCELLED(R.string.call_end_cancelled),
    FAILED(R.string.call_end_failed)
}

sealed class VoipCallState {
    object Idle : VoipCallState()
    object Connecting : VoipCallState()
    /** The app's leg is up: the notice plays and the other number rings or is talking (the server knows which). */
    object Connected : VoipCallState()
    data class Disconnected(val reason: CallEndReason) : VoipCallState()
}

/** The call the screen shows, kept here so it survives leaving the Phone screen. */
data class CurrentCall(val callId: String, val toNumber: String, val toName: String?, val timeLimitSeconds: Int)

/**
 * The app's leg of a phone call (Twilio Voice SDK). The server tells it nothing but a one-call token and the call id:
 * who is dialled, with which caller ID and for how long is decided on the server. No number is logged.
 */
@Singleton
class VoipService @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: PhoneRepository
) {
    private companion object { const val TAG = "VoipService" }

    private var activeCall: Call? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _callState = MutableStateFlow<VoipCallState>(VoipCallState.Idle)
    val callState: StateFlow<VoipCallState> = _callState.asStateFlow()

    private val _currentCall = MutableStateFlow<CurrentCall?>(null)
    val currentCall: StateFlow<CurrentCall?> = _currentCall.asStateFlow()

    private val _isMuted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    private val _isSpeakerOn = MutableStateFlow(false)
    val isSpeakerOn: StateFlow<Boolean> = _isSpeakerOn.asStateFlow()

    private val audioManager: AudioManager by lazy { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }

    // Saved to restore on call end. Without this the device is left in MODE_IN_COMMUNICATION, which mutes media.
    private var savedAudioMode: Int = AudioManager.MODE_NORMAL
    private var savedSpeakerphoneOn: Boolean = false
    private var audioPrepared = false

    fun hasActiveCall(): Boolean = activeCall != null

    /** Connects the call the server just reserved. Must be called while the app is in the foreground. */
    fun makeCall(call: CurrentCall, token: String): Boolean {
        if (activeCall != null) return false
        return try {
            _currentCall.value = call
            _callState.value = VoipCallState.Connecting
            // Audio routing must be set BEFORE Voice.connect: the SDK's audio stack reads it on connect.
            savedAudioMode = audioManager.mode
            savedSpeakerphoneOn = audioManager.isSpeakerphoneOn
            audioPrepared = true
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
            _isSpeakerOn.value = true
            CallForegroundService.start(context)
            val options = ConnectOptions.Builder(token).params(hashMapOf("call_id" to call.callId)).build()
            activeCall = Voice.connect(context, options, listener)
            true
        } catch (e: Exception) {
            report("connect", e.javaClass.simpleName)
            finish(call.callId, CallEndReason.FAILED)
            false
        }
    }

    /** The user hangs up. */
    fun disconnect() {
        val call = activeCall ?: return
        val id = _currentCall.value?.callId
        activeCall = null
        call.disconnect()
        finish(id, CallEndReason.CANCELLED)
    }

    /** The screen has shown how the call ended. */
    fun acknowledgeEnd() {
        if (activeCall != null) return
        _currentCall.value = null
        _callState.value = VoipCallState.Idle
    }

    fun toggleMute() {
        activeCall?.let { call ->
            val muted = !_isMuted.value
            call.mute(muted)
            _isMuted.value = muted
        }
    }

    fun toggleSpeaker() {
        val on = !_isSpeakerOn.value
        audioManager.isSpeakerphoneOn = on
        _isSpeakerOn.value = on
    }

    private fun finish(callId: String?, reason: CallEndReason) {
        activeCall = null
        _callState.value = VoipCallState.Disconnected(reason)
        CallForegroundService.stop(context)
        resetAudio()
        // Tells the server: frees the reservation if nothing was dialled, ends the call otherwise.
        if (callId != null) scope.launch { repository.hangup(callId) }
    }

    private fun resetAudio() {
        _isMuted.value = false
        _isSpeakerOn.value = false
        if (!audioPrepared) return
        audioPrepared = false
        audioManager.isSpeakerphoneOn = savedSpeakerphoneOn
        audioManager.mode = savedAudioMode
    }

    private fun report(stage: String, code: String) {
        Log.w(TAG, "call problem at $stage: $code")
        // i18n-ok: an error report, never shown to the user
        FailureReporter.failure("phone_call_$stage", message = "phone call $stage failed", context = mapOf("code" to code))
    }

    /** Callbacks for a call that is no longer the active one (already hung up here) are ignored. */
    private val listener = object : Call.Listener {
        override fun onConnectFailure(call: Call, callException: CallException) {
            if (activeCall !== call) return
            report("connect", callException.errorCode.toString())
            finish(_currentCall.value?.callId, CallEndReason.FAILED)
        }

        override fun onRinging(call: Call) = Unit

        override fun onConnected(call: Call) {
            if (activeCall === call) _callState.value = VoipCallState.Connected
        }

        override fun onReconnecting(call: Call, callException: CallException) = Unit

        override fun onReconnected(call: Call) {
            if (activeCall === call) _callState.value = VoipCallState.Connected
        }

        override fun onDisconnected(call: Call, callException: CallException?) {
            if (activeCall !== call) return
            if (callException != null) report("dropped", callException.errorCode.toString())
            finish(_currentCall.value?.callId, callEndReason(callException?.errorCode))
        }
    }
}

/** Voice SDK error codes: 31486 busy, 31487 cancelled; any other error is a failure; none is a normal end. */
fun callEndReason(errorCode: Int?): CallEndReason = when (errorCode) {
    null -> CallEndReason.COMPLETED
    31486 -> CallEndReason.BUSY
    31487 -> CallEndReason.CANCELLED
    else -> CallEndReason.FAILED
}
