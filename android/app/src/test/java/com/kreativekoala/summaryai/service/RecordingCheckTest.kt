package com.kreativekoala.summaryai.service

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingCheckTest {
    @Test fun underTenSecondsIsHeldHoweverLoud() {
        for (seconds in listOf(0, 1, 4, 9)) {
            assertEquals(RecordingProblem.TOO_SHORT, RecordingCheck.problem(seconds, 20_000))
            assertEquals(RecordingProblem.TOO_SHORT, RecordingCheck.problem(seconds, null))
        }
    }

    @Test fun tenSecondsWithSoundIsUploaded() {
        assertNull(RecordingCheck.problem(10, RecordingCheck.SILENT_PEAK))
        assertNull(RecordingCheck.problem(3600, 12_000))
    }

    @Test fun aMutedOrEmptyRoomRecordingIsHeld() {
        assertEquals(RecordingProblem.SILENT, RecordingCheck.problem(10, 0))
        assertEquals(RecordingProblem.SILENT, RecordingCheck.problem(600, RecordingCheck.SILENT_PEAK - 1))
    }

    @Test fun aLevelThatCouldNotBeMeasuredNeverBlocksAnUpload() {
        assertNull(RecordingCheck.problem(30, null))
    }

    @Test fun onlyALongSilentRecordingCanBeSentAnyway() {
        assertTrue(RecordingCheck.canUploadAnyway(RecordingProblem.SILENT, 10))
        assertFalse(RecordingCheck.canUploadAnyway(RecordingProblem.SILENT, 9))
        assertFalse(RecordingCheck.canUploadAnyway(RecordingProblem.TOO_SHORT, 9))
    }
}
