package com.kreativekoala.summaryai.data.sample

import android.content.SharedPreferences
import com.kreativekoala.summaryai.data.repository.RecordingsFilter
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingDetail
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import com.kreativekoala.summaryai.domain.model.Summary
import com.kreativekoala.summaryai.domain.model.Transcript
import com.kreativekoala.summaryai.domain.model.TranscriptSegment
import com.kreativekoala.summaryai.data.api.models.RecordingStatus as ApiRecordingStatus
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * A bundled, fictional 2-minute product sync that a brand-new user sees in their list so the product's output is
 * visible before they have recorded anything. It lives only in the app: it is never uploaded, never processed and
 * never billed, and every repository call that carries [ID] is answered locally (see RecordingsRepository).
 *
 * Content is invented: made-up first names, no brands, no contact details (SampleMeetingTest enforces this).
 */
object SampleMeeting {
    const val ID = "sample-meeting"
    const val TITLE = "Sample meeting"
    private const val DURATION_SECONDS = 112

    /** First-page results at or above this size mean the user already has plenty of real recordings. */
    private const val CROWDED_PAGE = 19

    fun isSample(id: String?): Boolean = id == ID

    private val speakers = mapOf("0" to "Maya", "1" to "Dev", "2" to "Priya", "3" to "Tomas")

    private fun seg(start: Int, end: Int, speaker: Int, text: String) =
        TranscriptSegment(start.toDouble(), end.toDouble(), text, "Speaker ${speaker + 1}")

    private val segments = listOf(
        seg(0, 9, 0, "Okay, quick product sync. Three things today: the new onboarding flow, the sync bug, and the release date."),
        seg(9, 20, 1, "Onboarding first. I finished the checklist screen yesterday. It's behind a flag and I tested it on two devices, so it's ready for review."),
        seg(20, 32, 2, "I looked at the numbers. Forty percent of new users stop at the permissions step, so I'd move the permission request to the moment they tap record."),
        seg(32, 40, 0, "Agreed. Priya, can you mock that up by Wednesday? Dev can wire it up as soon as you share it."),
        seg(40, 46, 2, "Yes, I'll have it by Wednesday morning."),
        seg(46, 60, 3, "On the sync bug, support got eleven tickets this week. Notes saved on a phone sometimes don't show up on the tablet until you reopen the app."),
        seg(60, 74, 1, "I can reproduce it. It's a race when two devices save within a few seconds. I think it's a one day fix, and I can ship it in Thursday's patch."),
        seg(74, 80, 0, "Great. Tomas, please send the affected customers a short note once the fix is out."),
        seg(80, 86, 3, "Will do. I'll draft it tomorrow so it's ready."),
        seg(86, 95, 0, "Last thing, the release date. Are we still good for the twentieth?"),
        seg(95, 104, 1, "If the permissions change lands next week, yes. If it slips, I'd push to the twenty-seventh."),
        seg(104, 112, 0, "Let's keep the twentieth and decide on Friday. Thanks everyone, that's all."),
    )

    private val fullText = segments.joinToString(" ") { it.text }

    private val summary = Summary(
        id = "sample-summary",
        shortSummary = "The team agreed to move the permission request to the moment a user taps record, to ship the " +
            "sync fix in Thursday's patch, and to keep the twentieth as the release date, with a final call on Friday.",
        detailedSummary = "Maya opened the weekly product sync with three topics. Dev has the new onboarding checklist " +
            "built behind a flag and ready for review. Priya's numbers show about forty percent of new users stop at " +
            "the permissions step, so the team will ask for the microphone only when someone taps record.\n\n" +
            "Support received eleven tickets about notes not appearing on a second device. Dev reproduced it: a race " +
            "when two devices save within seconds. He expects a one day fix in Thursday's patch, and Tomas will tell " +
            "affected customers once it is out. The release stays planned for the twentieth, moving to the " +
            "twenty-seventh if the permissions change slips; Maya will decide on Friday.",
        keyPoints = listOf(
            "The onboarding checklist is built behind a flag and ready for review.",
            "About 40% of new users stop at the permissions step; the request will move to the first tap on record.",
            "Support got 11 tickets this week about notes not syncing from a phone to a tablet.",
            "Dev reproduced the sync bug (a race when two devices save within seconds) and expects a one day fix.",
            "The fix is planned for Thursday's patch.",
            "The release stays planned for the 20th, and moves to the 27th if the permissions change slips.",
        ),
        actionItems = listOf(
            "Priya: share the permission step mockup by Wednesday morning",
            "Dev: ship the sync fix in Thursday's patch",
            "Tomas: draft a short note to affected customers and send it once the fix is out",
            "Maya: decide on the release date on Friday",
        ),
        topics = listOf("Onboarding", "Sync bug", "Release date"),
    )

    private val transcript = Transcript(
        id = "sample-transcript",
        fullText = fullText,
        segments = segments,
        language = "en",
        wordCount = fullText.split(Regex("\\s+")).size,
        speakerNames = speakers,
    )

    fun recording(createdAt: String) = Recording(
        id = ID,
        title = TITLE,
        durationSeconds = DURATION_SECONDS,
        status = RecordingStatus.COMPLETED,
        audioUrl = null,
        createdAt = createdAt,
    )

    fun detail(createdAt: String) = RecordingDetail(recording(createdAt), transcript, summary)

    /** Answer shown for any attempt to ask a question about the sample (no network, no cost). */
    const val QA_LOCKED_MESSAGE = "Questions work on your own recordings. Record one and ask away."

    /**
     * Adds the sample to the end of the first, unfiltered page of the server list. Skipped for later pages, any
     * filter, a status filter, a hidden sample, or a first page that is already nearly full (so the list's
     * "more pages" check, which counts rows, is never tipped by the extra row).
     */
    fun mergeIntoList(
        loaded: List<Recording>,
        page: Int,
        status: ApiRecordingStatus?,
        filter: RecordingsFilter,
        visible: Boolean,
        createdAt: String,
    ): List<Recording> {
        if (!visible || page != 1 || status != null || filter.isActive) return loaded
        if (loaded.size >= CROWDED_PAGE || loaded.any { it.id == ID }) return loaded
        return loaded + recording(createdAt)
    }
}

/**
 * Whether this install should show the sample. Only first-run users are seeded; deleting it is permanent.
 * Backed by SharedPreferences so the decision survives restarts without touching the account or the server.
 */
class SampleMeetingStore(
    private val prefs: SharedPreferences,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val isVisible: Boolean
        get() = prefs.getBoolean(K_SEEDED, false) && !prefs.getBoolean(K_DISMISSED, false)

    fun seed() {
        if (prefs.getBoolean(K_SEEDED, false) || prefs.getBoolean(K_DISMISSED, false)) return
        prefs.edit()
            .putBoolean(K_SEEDED, true)
            .putString(K_CREATED_AT, formatUtc(clock()))
            .apply()
    }

    fun dismiss() {
        prefs.edit().putBoolean(K_DISMISSED, true).apply()
    }

    /** Timestamp the sample row is dated with: when it was seeded, so it groups under "Today" on day one. */
    fun createdAt(): String = prefs.getString(K_CREATED_AT, null) ?: formatUtc(clock())

    private fun formatUtc(millis: Long): String =
        DateTimeFormatter.ISO_LOCAL_DATE_TIME.format(Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).withNano(0))

    companion object {
        const val PREFS_NAME = "mm_sample_meeting"
        private const val K_SEEDED = "seeded"
        private const val K_DISMISSED = "dismissed"
        private const val K_CREATED_AT = "created_at"
    }
}
