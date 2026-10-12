package com.kreativekoala.summaryai.ui.recordings.organize

import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class RecordingGroupingTest {
    private val zone = ZoneId.of("UTC")
    // Monday 2026-10-12 15:00 UTC
    private val now = ZonedDateTime.of(2026, 10, 12, 15, 0, 0, 0, zone)

    private fun rec(id: String, createdAt: String, fav: Boolean = false) = Recording(
        id = id,
        title = id,
        durationSeconds = 60,
        status = RecordingStatus.COMPLETED,
        audioUrl = null,
        createdAt = createdAt,
        isFavorite = fav,
    )

    @Test
    fun groupsByDayBucketsAndPutsStarredFirst() {
        val groups = groupRecordingsByDate(
            listOf(
                rec("today", "2026-10-12T09:00:00.123456+00:00"),
                rec("yesterday", "2026-10-11T23:59:00+00:00"),
                rec("week", "2026-10-07T10:00:00Z"),
                rec("month", "2026-10-02T10:00:00+00:00"),
                rec("sept", "2026-09-30T10:00:00+00:00"),
                rec("starredOld", "2025-01-01T10:00:00+00:00", fav = true),
                rec("bad", "not a date"),
            ),
            now,
        )
        assertEquals(
            listOf("Starred", "Today", "Yesterday", "This week", "This month", "September 2026", "Earlier"),
            groups.map { it.label },
        )
        assertEquals(listOf("starredOld"), groups[0].recordings.map { it.id })
    }

    @Test
    fun emptyInputGivesNoGroups() {
        assertEquals(emptyList<RecordingGroup>(), groupRecordingsByDate(emptyList(), now))
    }

    @Test
    fun usesTheDeviceZoneForDayBoundaries() {
        val la = ZoneId.of("America/Los_Angeles")
        val laNow = ZonedDateTime.of(2026, 10, 12, 9, 0, 0, 0, la)
        // 2026-10-12T03:00Z is still Oct 11 in LA -> Yesterday
        val groups = groupRecordingsByDate(listOf(rec("r", "2026-10-12T03:00:00+00:00")), laNow)
        assertEquals("Yesterday", groups.single().label)
    }
}
