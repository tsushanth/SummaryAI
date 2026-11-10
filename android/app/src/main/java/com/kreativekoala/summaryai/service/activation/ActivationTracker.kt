package com.kreativekoala.summaryai.service.activation

import android.content.SharedPreferences
import java.net.URLDecoder

/**
 * Activation funnel events. They go to Firebase Analytics (already in the app); there is no backend table.
 *
 * Names carry an `act_` prefix: `first_open` is reserved by Firebase (it fires its own), and the prefix keeps
 * these separable from the older ad-conversion events in [com.kreativekoala.summaryai.service.FirebaseAnalyticsHelper].
 *
 * Privacy contract (enforced by ActivationTrackerTest): scalar params only, never an email, title, transcript
 * text or user id. The anonymous id is Firebase's own app-instance id; nothing here sets a Firebase user id.
 */
object ActivationEvents {
    const val FIRST_OPEN = "act_first_open"
    const val SIGNUP_DONE = "act_signup_done"
    const val ONBOARDING_SHOWN = "act_onboarding_shown"
    const val ONBOARDING_SKIPPED = "act_onboarding_skipped"
    const val RECORD_TAPPED = "act_record_tapped"
    const val MIC_GRANTED = "act_mic_permission_granted"
    const val MIC_DENIED = "act_mic_permission_denied"
    const val FIRST_RECORDING_STARTED = "act_first_recording_started"
    const val FIRST_RECORDING_FINISHED = "act_first_recording_finished"
    const val FIRST_SUMMARY_VIEWED = "act_first_summary_viewed"
    const val SECOND_RECORDING = "act_second_recording"
    const val SAMPLE_DELETED = "act_sample_deleted"

    val ALL = listOf(
        FIRST_OPEN, SIGNUP_DONE, ONBOARDING_SHOWN, ONBOARDING_SKIPPED, RECORD_TAPPED, MIC_GRANTED, MIC_DENIED,
        FIRST_RECORDING_STARTED, FIRST_RECORDING_FINISHED, FIRST_SUMMARY_VIEWED, SECOND_RECORDING, SAMPLE_DELETED,
    )
}

/** Where events go. Production = Firebase; tests record. */
interface ActivationSink {
    fun log(name: String, params: Map<String, Any>)
    fun setUserProperty(name: String, value: String)
}

/** Reads the Play install referrer string once; calls back with null when it is unavailable. */
interface ReferrerFetcher {
    fun fetch(onResult: (String?) -> Unit)
}

data class InstallReferrer(val source: String?, val medium: String?, val campaign: String?)

object InstallReferrerParser {
    private const val MAX_LEN = 100
    private val SAFE = Regex("[^A-Za-z0-9._~+ -]")

    /** Keeps only utm_source / utm_medium / utm_campaign; every other key (gclid, email, ...) is dropped. */
    fun parse(raw: String?): InstallReferrer {
        if (raw.isNullOrBlank()) return InstallReferrer(null, null, null)
        val text = if (raw.contains("%3D", ignoreCase = true) && !raw.contains('=')) decode(raw) else raw
        val map = text.split('&').mapNotNull { pair ->
            val i = pair.indexOf('=')
            if (i <= 0) null else decode(pair.substring(0, i)) to decode(pair.substring(i + 1))
        }.toMap()
        fun clean(key: String): String? =
            map[key]?.let { SAFE.replace(it, "_").take(MAX_LEN) }?.takeIf { it.isNotBlank() }
        return InstallReferrer(clean("utm_source"), clean("utm_medium"), clean("utm_campaign"))
    }

    private fun decode(s: String) = try { URLDecoder.decode(s, "UTF-8") } catch (_: Exception) { s }
}

/** "update" when the app was installed long before this build was; those users are not a new-install cohort. */
fun installKind(firstInstallTime: Long, lastUpdateTime: Long): String =
    if (lastUpdateTime - firstInstallTime > 10 * 60_000L) "update" else "fresh"

fun durationBucket(seconds: Int): String = when {
    seconds < 2 -> "lt2s"
    seconds < 10 -> "2_10s"
    seconds < 30 -> "10_30s"
    seconds < 120 -> "30_120s"
    else -> "gt120s"
}

/**
 * One-shot funnel events with per-install dedupe. State lives in [prefs] so a restart never re-fires a
 * "first" event. All methods are cheap and safe to call from the main thread.
 */
class ActivationTracker(
    private val prefs: SharedPreferences,
    private val sink: ActivationSink,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private var referrerPending = false

    private fun once(key: String): Boolean {
        if (prefs.getBoolean(key, false)) return false
        prefs.edit().putBoolean(key, true).apply()
        return true
    }

    private fun flag(key: String) = prefs.getBoolean(key, false)

    // ---- first open + install referrer ---------------------------------------------------------

    /** Call on every app start. Only the very first start (per install) reads the referrer and fires first open. */
    @Synchronized
    fun onAppStart(installKind: String, fetcher: ReferrerFetcher) {
        if (flag(K_FIRST_OPEN) || referrerPending) return
        referrerPending = true
        fetcher.fetch { raw -> recordFirstOpen(installKind, raw) }
    }

    @Synchronized
    private fun recordFirstOpen(installKind: String, raw: String?) {
        if (!once(K_FIRST_OPEN)) return
        referrerPending = false
        val ref = InstallReferrerParser.parse(raw)
        prefs.edit()
            .putLong(K_FIRST_OPEN_TS, clock())
            .putString(K_UTM_SOURCE, ref.source)
            .putString(K_UTM_MEDIUM, ref.medium)
            .putString(K_UTM_CAMPAIGN, ref.campaign)
            .apply()
        // User properties let every later event be segmented by where the install came from (36 chars max).
        sink.setUserProperty("install_source", (ref.source ?: "none").take(36))
        sink.setUserProperty("install_medium", (ref.medium ?: "none").take(36))
        sink.setUserProperty("install_campaign", (ref.campaign ?: "none").take(36))
        sink.setUserProperty("install_kind", installKind)
        sink.log(
            ActivationEvents.FIRST_OPEN,
            mapOf(
                "install_kind" to installKind,
                "utm_source" to (ref.source ?: "none"),
                "utm_medium" to (ref.medium ?: "none"),
                "utm_campaign" to (ref.campaign ?: "none"),
            )
        )
    }

    fun storedReferrer() = InstallReferrer(
        prefs.getString(K_UTM_SOURCE, null),
        prefs.getString(K_UTM_MEDIUM, null),
        prefs.getString(K_UTM_CAMPAIGN, null),
    )

    // ---- funnel ----------------------------------------------------------------------------------

    fun signupDone(method: String) {
        if (once(K_SIGNUP)) sink.log(ActivationEvents.SIGNUP_DONE, mapOf("method" to method))
    }

    /** The first-run Record screen (one-line prompt) became visible. */
    fun firstRunPromptShown() {
        if (once(K_PROMPT_SHOWN)) sink.log(ActivationEvents.ONBOARDING_SHOWN, emptyMap())
    }

    /** The user left the first-run Record screen. A skip = they saw the prompt and never tapped record. */
    fun leftFirstRunPrompt(destination: String) {
        if (flag(K_PROMPT_SHOWN) && !flag(K_RECORD_TAPPED) && once(K_SKIPPED)) {
            sink.log(ActivationEvents.ONBOARDING_SKIPPED, mapOf("to" to destination))
        }
    }

    fun recordTapped() {
        val first = !flag(K_RECORD_TAPPED)
        prefs.edit().putBoolean(K_RECORD_TAPPED, true).apply()
        sink.log(ActivationEvents.RECORD_TAPPED, mapOf("is_first" to first))
    }

    fun micPermission(granted: Boolean) {
        sink.log(if (granted) ActivationEvents.MIC_GRANTED else ActivationEvents.MIC_DENIED, emptyMap())
    }

    fun recordingStarted() {
        val n = prefs.getInt(K_STARTED_COUNT, 0) + 1
        prefs.edit().putInt(K_STARTED_COUNT, n).apply()
        when (n) {
            1 -> sink.log(ActivationEvents.FIRST_RECORDING_STARTED, emptyMap())
            2 -> {
                val first = prefs.getLong(K_FIRST_OPEN_TS, clock())
                val days = ((clock() - first) / 86_400_000L).toInt().coerceAtLeast(0)
                sink.log(ActivationEvents.SECOND_RECORDING, mapOf("days_since_first_open" to days))
            }
        }
    }

    fun recordingFinished(durationSeconds: Int) {
        if (once(K_FINISHED)) {
            sink.log(ActivationEvents.FIRST_RECORDING_FINISHED, mapOf("duration_bucket" to durationBucket(durationSeconds)))
        }
    }

    /** A summary was shown. Counted once per kind so "saw the sample" and "saw my own" are separable. */
    fun summaryViewed(sample: Boolean) {
        val kind = if (sample) "sample" else "real"
        if (once(K_SUMMARY_PREFIX + kind)) sink.log(ActivationEvents.FIRST_SUMMARY_VIEWED, mapOf("kind" to kind))
    }

    fun sampleDeleted() {
        if (once(K_SAMPLE_DELETED)) sink.log(ActivationEvents.SAMPLE_DELETED, emptyMap())
    }

    companion object {
        const val PREFS_NAME = "mm_activation"
        private const val K_FIRST_OPEN = "first_open_done"
        private const val K_FIRST_OPEN_TS = "first_open_ts"
        private const val K_UTM_SOURCE = "utm_source"
        private const val K_UTM_MEDIUM = "utm_medium"
        private const val K_UTM_CAMPAIGN = "utm_campaign"
        private const val K_SIGNUP = "signup_done"
        private const val K_PROMPT_SHOWN = "prompt_shown"
        private const val K_SKIPPED = "onboarding_skipped"
        private const val K_RECORD_TAPPED = "record_tapped"
        private const val K_STARTED_COUNT = "recordings_started"
        private const val K_FINISHED = "first_recording_finished"
        private const val K_SUMMARY_PREFIX = "summary_viewed_"
        private const val K_SAMPLE_DELETED = "sample_deleted"
    }
}

/** Process-wide handle so Compose screens and view models can report without plumbing; a no-op until [install]. */
object Activation {
    @Volatile private var tracker: ActivationTracker? = null

    fun install(t: ActivationTracker) { tracker = t }

    /** Never throws: analytics must not be able to break a screen. */
    inline fun track(block: ActivationTracker.() -> Unit) {
        try { current()?.block() } catch (_: Exception) { }
    }

    fun current(): ActivationTracker? = tracker
}
