package com.kreativekoala.summaryai.service.activation

import android.content.SharedPreferences
import com.google.gson.Gson
import java.util.UUID

/**
 * Anonymous step counts for the record flow, sent to the backend table the monitoring can read
 * (`activation_events`, platform android). Firebase events cannot be read by the monitoring.
 *
 * The server accepts only its own event names, so the record flow reuses them:
 *   record_clicked           step = tap | mic_granted | mic_denied | start_failed | stop_ok | held_short |
 *                                   held_silent | keep_going | record_again | upload_anyway | check_dismissed
 *   first_recording_started  every recording that really started (again = true after "Record again")
 *   first_recording_done     every upload that finished: ok, seconds, auto
 *
 * Same privacy contract as [ActivationTracker]: a random id made for this purpose, numbers, booleans and short
 * words only. No account, title or audio.
 */
object RecordStepNames {
    const val CLICKED = "record_clicked"
    const val STARTED = "first_recording_started"
    const val DONE = "first_recording_done"
}

class RecordStepReporter(
    private val prefs: SharedPreferences,
    private val appVersion: String,
    private val testDevice: Boolean,
    private val post: (String) -> Unit,
) {
    @Synchronized
    private fun anonId(): String = prefs.getString(K_ANON_ID, null)
        ?: UUID.randomUUID().toString().also { prefs.edit().putString(K_ANON_ID, it).apply() }

    fun send(name: String, props: Map<String, Any>) {
        post(
            Gson().toJson(
                mapOf(
                    "anon_id" to anonId(),
                    "name" to name,
                    "platform" to "android",
                    "app_version" to appVersion,
                    "props" to props + ("test" to testDevice),
                )
            )
        )
    }

    private companion object { const val K_ANON_ID = "step_anon_id" }
}

/** Process-wide handle; a no-op until [install]. */
object RecordSteps {
    @Volatile private var reporter: RecordStepReporter? = null

    fun install(r: RecordStepReporter?) { reporter = r }

    /** Never throws: analytics must not be able to break recording. */
    fun track(name: String, vararg props: Pair<String, Any>) {
        try { reporter?.send(name, props.toMap()) } catch (_: Exception) { }
    }

    fun step(step: String, vararg props: Pair<String, Any>) =
        track(RecordStepNames.CLICKED, "step" to step, *props)
}
