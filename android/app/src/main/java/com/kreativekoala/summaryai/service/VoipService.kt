package com.kreativekoala.summaryai.service

import android.content.Context
import android.media.AudioManager
import android.util.Log
import com.twilio.voice.Call
import com.twilio.voice.CallException
import com.twilio.voice.ConnectOptions
import com.twilio.voice.Voice
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reason why a call ended
 */
enum class CallEndReason(val displayMessage: String) {
    COMPLETED("Call ended"),
    DECLINED("Call was declined"),
    BUSY("Line is busy"),
    NO_ANSWER("No answer"),
    CANCELLED("Call cancelled"),
    FAILED("Call failed"),
    UNKNOWN("Call ended")
}

/**
 * VoIP call state
 */
sealed class VoipCallState {
    object Idle : VoipCallState()
    object Connecting : VoipCallState()
    object Ringing : VoipCallState()
    object Connected : VoipCallState()
    data class Disconnected(val reason: CallEndReason, val message: String? = null) : VoipCallState()
    data class Failed(val error: String) : VoipCallState()
}

/**
 * Service for managing VoIP calls using Twilio Voice SDK
 */
@Singleton
class VoipService @Inject constructor(
    @ApplicationContext private val context: Context
) {
    companion object {
        private const val TAG = "VoipService"
    }

    private var activeCall: Call? = null
    private var accessToken: String? = null

    private val _callState = MutableStateFlow<VoipCallState>(VoipCallState.Idle)
    val callState: StateFlow<VoipCallState> = _callState.asStateFlow()

    private val _isMuted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    private val _isSpeakerOn = MutableStateFlow(false)
    val isSpeakerOn: StateFlow<Boolean> = _isSpeakerOn.asStateFlow()

    private val audioManager: AudioManager by lazy {
        context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    }

    // Saved to restore on call end. Without this, the device gets left in
    // MODE_IN_COMMUNICATION after the call which mutes media streams.
    private var savedAudioMode: Int = AudioManager.MODE_NORMAL
    private var savedSpeakerphoneOn: Boolean = false

    /**
     * Set the access token for VoIP calls
     */
    fun setAccessToken(token: String) {
        accessToken = token
        Log.d(TAG, "Access token set")
    }

    /**
     * Make an outbound VoIP call
     * @param callId The call ID from our backend
     * @param toNumber The phone number to call (for display purposes)
     */
    fun makeCall(callId: String, toNumber: String): Boolean {
        val token = accessToken
        if (token == null) {
            Log.e(TAG, "No access token set")
            _callState.value = VoipCallState.Failed("No access token")
            return false
        }

        if (activeCall != null) {
            Log.w(TAG, "Call already in progress")
            return false
        }

        try {
            _callState.value = VoipCallState.Connecting

            // Audio routing must be configured BEFORE Voice.connect — Twilio's
            // audio stack snapshots the AudioManager state on connect. Setting
            // these after onConnected leaves the device in MODE_NORMAL routing
            // to the earpiece at a low level, which is why callers reported
            // "I can't hear the other end".
            savedAudioMode = audioManager.mode
            savedSpeakerphoneOn = audioManager.isSpeakerphoneOn
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
            _isSpeakerOn.value = true
            Log.d(TAG, "Audio prepared: mode=IN_COMMUNICATION, speaker=true (was mode=$savedAudioMode, speaker=$savedSpeakerphoneOn)")

            // Build connect options with call_id parameter
            // This will be passed to our TwiML App webhook
            val params = HashMap<String, String>()
            params["call_id"] = callId
            params["to"] = toNumber

            val connectOptions = ConnectOptions.Builder(token)
                .params(params)
                .build()

            Log.d(TAG, "Making VoIP call to $toNumber with call_id=$callId")

            activeCall = Voice.connect(context, connectOptions, callListener)
            return true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to make call", e)
            _callState.value = VoipCallState.Failed(e.message ?: "Unknown error")
            return false
        }
    }

    /**
     * Disconnect the active call (user initiated)
     */
    fun disconnect() {
        activeCall?.disconnect()
        activeCall = null
        _callState.value = VoipCallState.Disconnected(CallEndReason.CANCELLED)
        resetAudio()
    }

    /**
     * Toggle mute
     */
    fun toggleMute() {
        activeCall?.let { call ->
            val newMuteState = !_isMuted.value
            call.mute(newMuteState)
            _isMuted.value = newMuteState
            Log.d(TAG, "Mute toggled: $newMuteState")
        }
    }

    /**
     * Toggle speaker
     */
    fun toggleSpeaker() {
        val newSpeakerState = !_isSpeakerOn.value
        audioManager.isSpeakerphoneOn = newSpeakerState
        _isSpeakerOn.value = newSpeakerState
        Log.d(TAG, "Speaker toggled: $newSpeakerState")
    }

    /**
     * Check if there's an active call
     */
    fun hasActiveCall(): Boolean = activeCall != null

    private fun resetAudio() {
        _isMuted.value = false
        _isSpeakerOn.value = false
        // Restore the audio state we snapshotted before the call so the device
        // doesn't get stuck in MODE_IN_COMMUNICATION (which mutes the MEDIA
        // stream and breaks subsequent music/TTS playback).
        audioManager.isSpeakerphoneOn = savedSpeakerphoneOn
        audioManager.mode = savedAudioMode
    }

    /**
     * Twilio Call listener
     */
    private val callListener = object : Call.Listener {
        override fun onConnectFailure(call: Call, callException: CallException) {
            Log.e(TAG, "Connect failure: ${callException.message}", callException)
            activeCall = null
            _callState.value = VoipCallState.Failed(callException.message ?: "Connection failed")
            resetAudio()
        }

        override fun onRinging(call: Call) {
            Log.d(TAG, "Call ringing")
            _callState.value = VoipCallState.Ringing
        }

        override fun onConnected(call: Call) {
            Log.d(TAG, "Call connected")
            _callState.value = VoipCallState.Connected
            // Audio mode + speaker were configured BEFORE Voice.connect in
            // makeCall(). Touching them here would fight Twilio's audio stack.
        }

        override fun onReconnecting(call: Call, callException: CallException) {
            Log.d(TAG, "Call reconnecting: ${callException.message}")
        }

        override fun onReconnected(call: Call) {
            Log.d(TAG, "Call reconnected")
            _callState.value = VoipCallState.Connected
        }

        override fun onDisconnected(call: Call, callException: CallException?) {
            Log.d(TAG, "Call disconnected: ${callException?.message}, errorCode: ${callException?.errorCode}")
            activeCall = null

            // Parse the disconnect reason from the exception
            val reason = parseDisconnectReason(callException)
            _callState.value = VoipCallState.Disconnected(reason, callException?.message)

            // resetAudio() already restores mode + speakerphone via the
            // savedAudioMode / savedSpeakerphoneOn snapshot. Don't force
            // MODE_NORMAL here — that overwrites whatever was running before.
            resetAudio()
        }
    }

    /**
     * Parse the disconnect reason from Twilio exception
     * Twilio error codes: https://www.twilio.com/docs/api/errors
     */
    private fun parseDisconnectReason(exception: CallException?): CallEndReason {
        if (exception == null) {
            return CallEndReason.COMPLETED
        }

        val message = exception.message?.lowercase() ?: ""
        val errorCode = exception.errorCode

        return when {
            // Check for specific Twilio error codes
            errorCode == 31005 -> CallEndReason.DECLINED // Call rejected
            errorCode == 31486 -> CallEndReason.BUSY // Busy
            errorCode == 31480 -> CallEndReason.NO_ANSWER // Timeout/No answer
            errorCode == 31487 -> CallEndReason.CANCELLED // Cancelled

            // Fall back to message parsing
            message.contains("rejected") || message.contains("declined") -> CallEndReason.DECLINED
            message.contains("busy") -> CallEndReason.BUSY
            message.contains("no answer") || message.contains("timeout") -> CallEndReason.NO_ANSWER
            message.contains("cancel") -> CallEndReason.CANCELLED
            message.contains("failed") || message.contains("error") -> CallEndReason.FAILED

            // No exception means normal completion
            else -> CallEndReason.UNKNOWN
        }
    }
}
