package com.kreativekoala.summaryai.service.voice

import java.net.URLEncoder
import java.time.LocalDate
import java.time.ZoneOffset

/**
 * Description of a system intent for an action that leaves the app. The app never sends anything itself: the mail or
 * calendar app opens with the content filled in, and the user's own tap there is the confirmation. No account, no new
 * permission and no Google API scope is involved. Kept as plain data so it is testable without Android classes;
 * the screen turns it into an Intent.
 */
data class OutwardIntentSpec(
    val kind: String,
    val action: String,
    val dataUri: String?,
    val extras: Map<String, Any> = emptyMap(),
)

object OutwardIntents {
    const val ACTION_SENDTO = "android.intent.action.SENDTO"
    const val ACTION_INSERT = "android.intent.action.INSERT"
    const val CALENDAR_EVENTS_URI = "content://com.android.calendar/events"

    /** An email draft in the user's mail app. [to] is optional; the user chooses the recipient there. */
    fun emailDraft(subject: String, body: String, to: String? = null): OutwardIntentSpec {
        val query = "subject=${enc(subject)}&body=${enc(body)}"
        return OutwardIntentSpec(
            kind = "email_draft",
            action = ACTION_SENDTO,
            dataUri = "mailto:${to?.let { enc(it) }.orEmpty()}?$query",
        )
    }

    /** An all-day calendar entry on [dueIso] (YYYY-MM-DD) for the user's calendar app to save. Null if the date is not a date. */
    fun calendarHold(title: String, dueIso: String, notes: String? = null): OutwardIntentSpec? {
        val day = SpokenText.parse(dueIso) ?: return null
        val begin = day.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        val end = day.plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        val extras = linkedMapOf<String, Any>(
            "title" to title,
            "beginTime" to begin,
            "endTime" to end,
            "allDay" to true,
        )
        if (!notes.isNullOrBlank()) extras["description"] = notes
        return OutwardIntentSpec(kind = "calendar_hold", action = ACTION_INSERT, dataUri = CALENDAR_EVENTS_URI, extras = extras)
    }

    /** Text for an email about one action. Contains only what the user already sees on the confirm sheet. */
    fun emailForAction(draft: ActionDraft, today: LocalDate): OutwardIntentSpec {
        val due = SpokenText.day(draft.dueDate, today)
        val body = buildString {
            append(draft.title.trimEnd('.')).append('.')
            draft.assignee?.takeIf { it.isNotBlank() }?.let { append("\nOwner: ").append(it) }
            if (due != null) append("\nDue: ").append(due)
        }
        return emailDraft(subject = "Action: ${draft.title.trimEnd('.')}", body = body)
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
}
