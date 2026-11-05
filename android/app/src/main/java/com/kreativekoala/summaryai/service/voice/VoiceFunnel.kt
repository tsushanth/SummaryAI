package com.kreativekoala.summaryai.service.voice

import com.kreativekoala.summaryai.service.activation.ActivationSink
import com.kreativekoala.summaryai.service.activation.FirebaseActivationSink

/**
 * Funnel events for hands-free features (spoken debrief, ask by voice, action items by voice). They go to Firebase
 * Analytics through the same sink the activation events use; nothing is stored on a server.
 *
 * Privacy contract (enforced by VoiceFunnelTest): the event name must be one of [VoiceEvents.ALL]; params are
 * Boolean / numbers or short lower-case tokens (letters, digits, underscore, at most 40 chars). Anything else, such as
 * a transcript, a title, a name, an email or a free-text answer, is dropped before it reaches the sink. No audio, no
 * recognised text, no user id.
 *
 * Nothing calls this yet: it is the instrumentation the voice screens will use, so the funnel exists from the first build.
 */
object VoiceEvents {
    // Pre-use: was the entry point visible, and did anyone tap it (the denominator for everything after).
    const val ENTRY_SHOWN = "voice_entry_shown"
    const val ENTRY_TAPPED = "voice_entry_tapped"
    const val CONSENT_SHOWN = "voice_consent_shown"
    const val CONSENT_ACCEPTED = "voice_consent_accepted"
    const val CONSENT_DECLINED = "voice_consent_declined"
    const val MIC_DENIED = "voice_mic_denied"

    // Listening and understanding.
    const val HEARD = "voice_heard"
    const val NOT_UNDERSTOOD = "voice_not_understood"

    // Debrief after a meeting.
    const val DEBRIEF_OFFERED = "voice_debrief_offered"
    const val DEBRIEF_STARTED = "voice_debrief_started"
    const val DEBRIEF_FINISHED = "voice_debrief_finished"
    const val DEBRIEF_STOPPED = "voice_debrief_stopped"

    // Questions across meetings.
    const val ASK_ANSWERED = "voice_ask_answered"
    const val ASK_DECLINED = "voice_ask_declined"
    const val ANSWER_REPORTED_WRONG = "voice_answer_reported_wrong"

    // Action items: draft, read back, confirm or not.
    const val ACTION_DRAFTED = "voice_action_drafted"
    const val ACTION_CONFIRMED = "voice_action_confirmed"
    const val ACTION_EDITED = "voice_action_edited"
    const val ACTION_CANCELLED = "voice_action_cancelled"
    const val ACTION_UNDONE = "voice_action_undone"

    // Actions that leave the app (an email draft, a calendar hold, a chat post): the user's final tap is the confirmation.
    const val OUTWARD_PREPARED = "voice_outward_prepared"
    const val OUTWARD_COMPLETED = "voice_outward_completed"
    const val OUTWARD_ABANDONED = "voice_outward_abandoned"

    val ALL: Set<String> = setOf(
        ENTRY_SHOWN, ENTRY_TAPPED, CONSENT_SHOWN, CONSENT_ACCEPTED, CONSENT_DECLINED, MIC_DENIED,
        HEARD, NOT_UNDERSTOOD,
        DEBRIEF_OFFERED, DEBRIEF_STARTED, DEBRIEF_FINISHED, DEBRIEF_STOPPED,
        ASK_ANSWERED, ASK_DECLINED, ANSWER_REPORTED_WRONG,
        ACTION_DRAFTED, ACTION_CONFIRMED, ACTION_EDITED, ACTION_CANCELLED, ACTION_UNDONE,
        OUTWARD_PREPARED, OUTWARD_COMPLETED, OUTWARD_ABANDONED,
    )
}

class VoiceFunnel(private val sink: ActivationSink = FirebaseActivationSink) {

    /** Logs [name] with the params that pass the privacy filter. Unknown names are ignored. Never throws. */
    fun log(name: String, params: Map<String, Any?> = emptyMap()) {
        if (name !in VoiceEvents.ALL) return
        try {
            sink.log(name, sanitize(params))
        } catch (_: Exception) {
            // Analytics must never break a screen.
        }
    }

    // ---- typed helpers: the only params the funnel carries ----------------------------------------------------

    /** [surface] is where it was shown: "todos", "meeting", "notification", "widget", "tile". */
    fun entryShown(surface: String) = log(VoiceEvents.ENTRY_SHOWN, mapOf("surface" to surface))
    fun entryTapped(surface: String) = log(VoiceEvents.ENTRY_TAPPED, mapOf("surface" to surface))

    /** [recognizer] is "on_device" or "network"; text length is a count, never the text. */
    fun heard(recognizer: String, charCount: Int, durationMs: Long) =
        log(VoiceEvents.HEARD, mapOf("recognizer" to recognizer, "char_count" to charCount, "duration_ms" to durationMs))

    fun notUnderstood(reason: String) = log(VoiceEvents.NOT_UNDERSTOOD, mapOf("reason" to reason))

    fun debriefFinished(listenedPercent: Int, decisions: Int, actions: Int) = log(
        VoiceEvents.DEBRIEF_FINISHED,
        mapOf("listened_pct" to listenedPercent.coerceIn(0, 100), "decisions" to decisions, "actions" to actions),
    )

    fun actionDrafted(hasDue: Boolean, hasOwner: Boolean) =
        log(VoiceEvents.ACTION_DRAFTED, mapOf("has_due" to hasDue, "has_owner" to hasOwner))

    /** How the draft ended, so "confirmed without edit" can be read straight from the counts. */
    fun actionConfirmed(edited: Boolean) = log(if (edited) VoiceEvents.ACTION_EDITED else VoiceEvents.ACTION_CONFIRMED)

    /** [kind]: "email_draft", "calendar_hold" or "chat_post". */
    fun outwardPrepared(kind: String) = log(VoiceEvents.OUTWARD_PREPARED, mapOf("kind" to kind))
    fun outwardCompleted(kind: String) = log(VoiceEvents.OUTWARD_COMPLETED, mapOf("kind" to kind))

    companion object {
        private val TOKEN = Regex("^[a-z0-9_]{1,40}$")

        internal fun sanitize(params: Map<String, Any?>): Map<String, Any> {
            val out = LinkedHashMap<String, Any>()
            for ((k, v) in params) {
                if (!TOKEN.matches(k)) continue
                when (v) {
                    is Boolean, is Int, is Long, is Double -> out[k] = v
                    is String -> if (TOKEN.matches(v)) out[k] = v
                    else -> Unit
                }
            }
            return out
        }
    }
}
