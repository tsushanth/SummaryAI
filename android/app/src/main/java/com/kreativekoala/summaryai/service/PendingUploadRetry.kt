package com.kreativekoala.summaryai.service

import retrofit2.HttpException
import java.io.File
import java.io.IOException

/**
 * The sidecar next to a recording that is not uploaded yet (`recording_x.meta`, one `key=value` per line).
 *
 * A sidecar written by an older build has only the title and length: its recording is offered in the "not uploaded"
 * banner but never sent automatically.
 */
internal data class PendingUploadMeta(
    val title: String? = null,
    val durationSeconds: Int = 0,
    /** Account that sent it. An automatic retry only ever uploads to this account. */
    val owner: String? = null,
    /** True after a failure that left no audio on the server and may succeed later. */
    val retryAutomatically: Boolean = false,
    val automaticAttempts: Int = 0,
    val lastFailureMs: Long = 0,
) {
    fun writeFor(audio: File) {
        runCatching { fileFor(audio).writeText(encode()) }
    }

    private fun encode(): String = buildString {
        title?.let { append("title=").append(it.replace('\n', ' ').replace('\r', ' ')).append('\n') }
        append("duration=").append(durationSeconds).append('\n')
        owner?.let { append("owner=").append(it).append('\n') }
        append("auto_retry=").append(retryAutomatically).append('\n')
        append("auto_attempts=").append(automaticAttempts).append('\n')
        append("last_failure=").append(lastFailureMs).append('\n')
    }

    companion object {
        fun fileFor(audio: File): File = File(audio.parentFile, audio.nameWithoutExtension + ".meta")

        fun read(audio: File): PendingUploadMeta {
            val values = runCatching { fileFor(audio).readLines() }.getOrDefault(emptyList())
                .filter { '=' in it }
                .associate { it.substringBefore('=') to it.substringAfter('=') }
            return PendingUploadMeta(
                title = values["title"],
                durationSeconds = values["duration"]?.toIntOrNull() ?: 0,
                owner = values["owner"],
                retryAutomatically = values["auto_retry"] == "true",
                automaticAttempts = values["auto_attempts"]?.toIntOrNull() ?: 0,
                lastFailureMs = values["last_failure"]?.toLongOrNull() ?: 0,
            )
        }
    }
}

/** When a recording whose upload failed is sent again without the user tapping Retry. */
internal object AutomaticUploadRetry {
    const val MAX_ATTEMPTS = 3
    const val MIN_GAP_MS = 10 * 60_000L

    /**
     * True when the audio did not reach the server and the same upload may work later: the failure was while creating the
     * recording or sending the file, and was a network error or a server error. A failure of the last step
     * ("complete") is excluded because the server has the audio and finishes it itself; sending it again would make a
     * second copy.
     *
     * [putStatus] is the HTTP status of the last storage PUT attempt, null when it got no response.
     */
    fun worthRetrying(stage: String, error: Throwable, putStatus: Int?): Boolean {
        if (stage != "create" && stage != "storage_put") return false
        val status = (error as? HttpException)?.code() ?: putStatus.takeIf { stage == "storage_put" }
        return if (status != null) status >= 500 || status == 408 || status == 429 else error is IOException
    }

    /**
     * Takes the first of the [pending] files that [userId] may send now and counts the attempt, or null. The sidecar is
     * rewritten before the upload starts, so the same file cannot be taken twice. [Claim.undo] puts it back when the
     * upload could not be started.
     */
    fun claim(pending: List<File>, userId: String?, nowMs: Long): Claim? {
        if (userId == null) return null
        for (file in pending) {
            val meta = PendingUploadMeta.read(file)
            val due = meta.retryAutomatically && meta.owner == userId &&
                meta.automaticAttempts < MAX_ATTEMPTS && nowMs - meta.lastFailureMs >= MIN_GAP_MS
            if (!due) continue
            val claimed = meta.copy(retryAutomatically = false, automaticAttempts = meta.automaticAttempts + 1)
            claimed.writeFor(file)
            return Claim(file, claimed, before = meta)
        }
        return null
    }

    class Claim(val file: File, val meta: PendingUploadMeta, private val before: PendingUploadMeta) {
        fun undo() = before.writeFor(file)
    }
}
