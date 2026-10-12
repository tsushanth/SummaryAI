package com.kreativekoala.summaryai.ui.recordings.organize

import com.kreativekoala.summaryai.data.repository.UNFILED_FOLDER_ID
import com.kreativekoala.summaryai.ui.recordings.RecordingsTab
import com.kreativekoala.summaryai.ui.recordings.recordingTypeForTab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset

class ListFilterTest {
    @Test
    fun dateRangeBecomesInclusiveInstantsInTheUsersZone() {
        val r = DateRangeSelection(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 3))
        val zone = ZoneId.of("America/Los_Angeles") // UTC-7 in October
        assertEquals("2026-10-01T07:00:00Z", r.fromIso(zone))
        assertEquals("2026-10-04T06:59:59.999Z", r.toIso(zone))
    }

    @Test
    fun pickerMillisAreReadAsUtcCalendarDaysAndReordered() {
        val oct3 = LocalDate.of(2026, 10, 3).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        val oct1 = LocalDate.of(2026, 10, 1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        assertEquals(
            DateRangeSelection(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 3)),
            DateRangeSelection.fromPickerMillis(oct3, oct1)
        )
        // Single tap = one day
        assertEquals(
            DateRangeSelection(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 1)),
            DateRangeSelection.fromPickerMillis(oct1, null)
        )
        assertNull(DateRangeSelection.fromPickerMillis(null, null))
    }

    @Test
    fun filterBuilderMapsSelectionsToServerParams() {
        val none = buildRecordingsFilter(false, null, null, null)
        assertFalse(none.isActive)

        val range = DateRangeSelection(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 10, 1))
        val f = buildRecordingsFilter(true, "folder-1", "q3", range, ZoneOffset.UTC)
        assertEquals("folder-1", f.folderId)
        assertEquals("q3", f.tag)
        assertEquals(true, f.favorite)
        assertEquals("2026-10-01T00:00:00Z", f.from)
        assertEquals("2026-10-01T23:59:59.999Z", f.to)
        assertTrue(f.isActive)
    }

    @Test
    fun tabsMapToServerRecordingType() {
        assertEquals("meeting", recordingTypeForTab(RecordingsTab.MEETINGS))
        assertEquals("imported", recordingTypeForTab(RecordingsTab.IMPORTED))
        assertNull(recordingTypeForTab(RecordingsTab.ALL))
        assertNull(recordingTypeForTab(RecordingsTab.FAVORITES))
        assertNull(recordingTypeForTab(RecordingsTab.TODOS))
        val f = buildRecordingsFilter(false, null, null, null, recordingType = "meeting")
        assertEquals("meeting", f.recordingType)
        assertTrue(f.isActive)
    }

    @Test
    fun unfiledFolderSentinelMatchesServerValue() {
        assertEquals("none", UNFILED_FOLDER_ID)
        assertEquals("none", buildRecordingsFilter(false, UNFILED_FOLDER_ID, null, null).folderId)
    }

    @Test
    fun folderNameValidationMatchesServerLimits() {
        assertFalse(isValidFolderName("   "))
        assertTrue(isValidFolderName(" Q3 "))
        assertTrue(isValidFolderName("x".repeat(60)))
        assertFalse(isValidFolderName("x".repeat(61)))
    }
}
