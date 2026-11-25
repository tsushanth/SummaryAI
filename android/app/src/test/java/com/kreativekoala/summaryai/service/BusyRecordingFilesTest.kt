package com.kreativekoala.summaryai.service

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class BusyRecordingFilesTest {
    private val old = File("/r/recording_old.m4a")
    private val current = File("/r/recording_now.m4a")

    @Test
    fun `idle - every file on disk is pending`() {
        assertEquals(listOf(current, old), BusyRecordingFiles().pendingAmong(listOf(current, old)))
    }

    @Test
    fun `recording - nothing is offered, so the file being written cannot be uploaded or discarded`() {
        val busy = BusyRecordingFiles().apply { recording = current }
        assertEquals(emptyList<File>(), busy.pendingAmong(listOf(current, old)))
    }

    @Test
    fun `uploading - the file being sent is not offered again`() {
        val busy = BusyRecordingFiles().apply { uploading = current }
        assertEquals(listOf(old), busy.pendingAmong(listOf(current, old)))
        busy.finishedUploading(current)
        assertEquals(listOf(current, old), busy.pendingAmong(listOf(current, old)))
    }

    @Test
    fun `a finished earlier upload does not free the file of a later one`() {
        val busy = BusyRecordingFiles().apply { uploading = current }
        busy.finishedUploading(old)
        assertEquals(listOf(old), busy.pendingAmong(listOf(current, old)))
    }
}
