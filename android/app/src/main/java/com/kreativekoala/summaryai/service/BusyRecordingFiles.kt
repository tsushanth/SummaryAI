package com.kreativekoala.summaryai.service

import java.io.File

/**
 * The recording files in use right now, so they are never offered as "not uploaded yet".
 *
 * Every .m4a in the recordings folder used to be offered with Upload and Discard, including the one still being
 * recorded: uploading it failed because it kept growing, and discarding it deleted the recording.
 */
internal class BusyRecordingFiles {
    @Volatile var recording: File? = null
    @Volatile var uploading: File? = null

    /** A later upload may have replaced [uploading]; only clear it if it is still this file. */
    fun finishedUploading(file: File) {
        if (uploading == file) uploading = null
    }

    /**
     * Of the files on disk, those that are safe to offer. None while a recording is running, because no upload can
     * start then.
     */
    fun pendingAmong(files: List<File>): List<File> {
        if (recording != null) return emptyList()
        val sending = uploading
        return files.filter { it != sending }
    }
}
