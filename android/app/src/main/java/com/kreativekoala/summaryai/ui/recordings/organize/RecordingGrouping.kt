package com.kreativekoala.summaryai.ui.recordings.organize

import com.kreativekoala.summaryai.domain.model.Recording
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.TextStyle
import java.util.Locale

data class RecordingGroup(val label: String, val recordings: List<Recording>)

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
    val buckets = LinkedHashMap<String, MutableList<Recording>>()

    for (r in recordings) {
        if (r.isFavorite) {
            starred += r
            continue
        }
        val d = parseCreatedAt(r.createdAt, zone)
        val label = when {
            d == null -> "Earlier"
            !d.isBefore(today) -> "Today"
            d == today.minusDays(1) -> "Yesterday"
            !d.isBefore(weekStart) -> "This week"
            d.year == today.year && d.month == today.month -> "This month"
            else -> "${d.month.getDisplayName(TextStyle.FULL, Locale.US)} ${d.year}"
        }
        buckets.getOrPut(label) { mutableListOf() } += r
    }

    val out = mutableListOf<RecordingGroup>()
    if (starred.isNotEmpty()) out += RecordingGroup("Starred", starred)
    buckets.forEach { (label, list) -> out += RecordingGroup(label, list) }
    return out
}
