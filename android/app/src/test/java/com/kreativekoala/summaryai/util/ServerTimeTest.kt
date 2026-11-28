package com.kreativekoala.summaryai.util

import android.content.ContextWrapper
import com.kreativekoala.summaryai.ui.meetings.meetingTimeText
import com.kreativekoala.summaryai.ui.phone.formatCallDate
import com.kreativekoala.summaryai.ui.recordings.formatDate
import com.kreativekoala.summaryai.ui.recordings.formatDateIOS
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale
import java.util.TimeZone

class ServerTimeTest {
    private lateinit var savedZone: TimeZone
    private lateinit var savedLocale: Locale

    @Before
    fun pacificTime() {
        savedZone = TimeZone.getDefault()
        savedLocale = Locale.getDefault()
        TimeZone.setDefault(TimeZone.getTimeZone("America/Los_Angeles"))
        Locale.setDefault(Locale.US)
    }

    @After
    fun restore() {
        TimeZone.setDefault(savedZone)
        Locale.setDefault(savedLocale)
    }

    // Recorded 16:15 PT on 27 Nov 2026.
    private val evening = "2026-11-28T00:15:00.123456+00:00"
    private val moment = Instant.parse("2026-11-28T00:15:00.123456Z")

    @Test
    fun utcOffsetZAndNoOffsetAllMeanTheSameMoment() {
        assertEquals(moment, ServerTime.parse(evening))
        assertEquals(moment, ServerTime.parse("2026-11-28T00:15:00.123456Z"))
        assertEquals(moment, ServerTime.parse("2026-11-28T00:15:00.123456"))
        assertEquals(moment, ServerTime.parse("2026-11-28 00:15:00.123456+00"))
    }

    @Test
    fun explicitOffsetsAreHonoured() {
        val whole = Instant.parse("2026-11-28T00:15:00Z")
        assertEquals(whole, ServerTime.parse("2026-11-27T16:15:00-08:00"))
        assertEquals(whole, ServerTime.parse("2026-11-28T05:45:00+05:30"))
        assertEquals(whole, ServerTime.parse("2026-11-28T05:45:00+0530"))
        assertEquals(whole, ServerTime.parse("2026-11-28T00:15Z"))
    }

    @Test
    fun anyFractionLengthIsAccepted() {
        for (digits in 1..9) {
            val fraction = "123456789".take(digits)
            assertEquals(
                Instant.parse("2026-11-28T00:15:00.${fraction.padEnd(9, '0')}Z"),
                ServerTime.parse("2026-11-28T00:15:00.$fraction"),
            )
        }
    }

    @Test
    fun datesOnlyAndJunkAreNotMoments() {
        for (value in listOf(null, "", "2026-11-27", "not a date", "2026-13-40T00:00:00Z", "2026-11-28T00:15:00Z and more")) {
            assertNull(value, ServerTime.parse(value))
        }
    }

    @Test
    fun dayIsTheDevicesDay() {
        assertEquals(LocalDate.of(2026, 11, 27), ServerTime.localDate(evening))
        assertEquals(LocalDate.of(2026, 11, 28), ServerTime.localDate(evening, ZoneId.of("Asia/Kolkata")))
        assertEquals("2026-11-27", ServerTime.dayText(evening))
        assertEquals("2026-11-27", ServerTime.dayText("2026-11-27"))
    }

    @Test
    fun recordingListShowsTheLocalDay() {
        assertEquals("Nov 27, 2026", formatDate(evening))
        assertEquals("Nov 27", formatDateIOS(evening))
        assertEquals("Nov 27", formatDateIOS("2026-11-28T00:15:00"))
        assertEquals("2026-11-27", formatDate("2026-11-27"))
        assertEquals("soon", formatDateIOS("soon"))
    }

    @Test
    fun meetingShowsTheLocalTime() {
        assertEquals("Fri, Nov 27, 4:15 PM", meetingTimeText(evening, null))
        assertEquals("Fri, Nov 27, 4:15 PM", meetingTimeText("2026-11-27T16:15:00-08:00", "2026-11-27T17:15:00-08:00"))
        // 4 PM to 5 PM Pacific starts at midnight UTC but is not an all-day event.
        assertEquals("Fri, Nov 27, 4:00 PM", meetingTimeText("2026-11-28T00:00:00+00:00", "2026-11-28T01:00:00+00:00"))
    }

    @Test
    fun allDayMeetingKeepsItsDate() {
        val start = "2026-11-28T00:00:00+00:00"
        assertEquals("Sat, Nov 28", meetingTimeText(start, "2026-11-29T00:00:00+00:00"))
        assertEquals("Sat, Nov 28", meetingTimeText(start, "2026-12-01T00:00:00+00:00"))
        assertNull(ServerTime.allDayDate(start, null))
        assertNull(ServerTime.allDayDate(start, start))
    }

    @Test
    fun phoneCallShowsTheLocalTimeAndHonoursTheOffset() {
        val context = ContextWrapper(null) // only read for "today" and "yesterday"
        assertEquals("Mar 5, 4:15 PM", formatCallDate(context, "2020-03-06T00:15:00"))
        assertEquals("Mar 5, 4:15 PM", formatCallDate(context, "2020-03-06T05:45:00.5+05:30"))
    }
}
