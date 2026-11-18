package com.kreativekoala.summaryai.ui.recordings.organize

import com.kreativekoala.summaryai.domain.model.Recording
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime

/** Which header a group of recordings sits under. Resolved to text by the UI so it follows the user's language. */
sealed interface GroupLabel {
    /** Stable id for list item keys. */
    val key: String

    object Starred : GroupLabel { override val key = "starred" }
    object Today : GroupLabel { override val key = "today" }
    object Yesterday : GroupLabel { override val key = "yesterday" }
    object ThisWeek : GroupLabel { override val key = "this_week" }
    object ThisMonth : GroupLabel { override val key = "this_month" }
    object Earlier : GroupLabel { override val key = "earlier" }
    data class Month(val year: Int, val month: Int) : GroupLabel { override val key get() = "month_$year-$month" }
}

data class RecordingGroup(val label: GroupLabel, val recordings: List<Recording>)

/** Parses the server's ISO-8601 timestamp; null when it cannot be parsed. */
internal fun parseCreatedAt(value: String, zone: ZoneId): LocalDate? = try {
    OffsetDateTime.parse(value).atZoneSameInstant(zone).toLocalDate()
} catch (e: Exception) {
    try {
        // Timestamps without an offset are treated as UTC (the server stores timestamptz).
        java.time.LocalDateTime.parse(value.substringBefore('.')).atZone(ZoneId.of("UTC"))
            .withZoneSameInstant(zone).toLocalDate()
    } catch (e2: Exception) {
        null
    }
}

/**
 * Starred (favorite) recordings first, then Today / Yesterday / This week /
 * This month / "<Month> <Year>" / Earlier. Starred recordings are not repeated
 * in the date groups. Input order is preserved inside each group.
 */
fun groupRecordingsByDate(
    recordings: List<Recording>,
    now: ZonedDateTime = ZonedDateTime.now(),
): List<RecordingGroup> {
    val zone = now.zone
    val today = now.toLocalDate()
    val weekStart = today.minusDays(6)

    val starred = mutableListOf<Recording>()
    val buckets = LinkedHashMap<GroupLabel, MutableList<Recording>>()

    for (r in recordings) {
        if (r.isFavorite) {
            starred += r
            continue
        }
        val d = parseCreatedAt(r.createdAt, zone)
        val label = when {
            d == null -> GroupLabel.Earlier
            !d.isBefore(today) -> GroupLabel.Today
            d == today.minusDays(1) -> GroupLabel.Yesterday
            !d.isBefore(weekStart) -> GroupLabel.ThisWeek
            d.year == today.year && d.month == today.month -> GroupLabel.ThisMonth
            else -> GroupLabel.Month(d.year, d.monthValue)
        }
        buckets.getOrPut(label) { mutableListOf() } += r
    }

    val out = mutableListOf<RecordingGroup>()
    if (starred.isNotEmpty()) out += RecordingGroup(GroupLabel.Starred, starred)
    buckets.forEach { (label, list) -> out += RecordingGroup(label, list) }
    return out
}
