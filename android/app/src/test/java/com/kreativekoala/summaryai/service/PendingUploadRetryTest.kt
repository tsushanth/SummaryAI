package com.kreativekoala.summaryai.service

import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import retrofit2.HttpException
import retrofit2.Response
import java.io.File
import java.io.IOException

class PendingUploadRetryTest {
    @get:Rule val folder = TemporaryFolder()

    private val now = 100 * AutomaticUploadRetry.MIN_GAP_MS

    private fun recording(name: String = "recording_a", meta: PendingUploadMeta? = failed()): File {
        val file = folder.newFile("$name.m4a")
        meta?.writeFor(file)
        return file
    }

    private fun failed(owner: String = "user-1", attempts: Int = 0, at: Long = 0) = PendingUploadMeta(
        title = "Standup", durationSeconds = 31, owner = owner,
        retryAutomatically = true, automaticAttempts = attempts, lastFailureMs = at,
    )

    private fun claim(vararg files: File, user: String? = "user-1") = AutomaticUploadRetry.claim(files.toList(), user, now)

    @Test fun `sidecar keeps every field`() {
        val meta = failed(attempts = 2, at = 42).copy(title = "a = b\nsecond line")
        val file = recording(meta = meta)
        assertEquals(meta.copy(title = "a = b second line"), PendingUploadMeta.read(file))
    }

    @Test fun `a sidecar from an older build is read but never sent automatically`() {
        val file = recording(meta = null)
        PendingUploadMeta.fileFor(file).writeText("title=Old\nduration=7\n")
        assertEquals(PendingUploadMeta(title = "Old", durationSeconds = 7), PendingUploadMeta.read(file))
        assertNull(claim(file))
    }

    @Test fun `a file with no sidecar is never sent automatically`() {
        assertNull(claim(recording(meta = null)))
    }

    @Test fun `a failed upload is claimed once and the attempt counted`() {
        val file = recording()
        val claim = claim(file)
        assertEquals(file, claim?.file)
        assertEquals(1, claim?.meta?.automaticAttempts)
        assertEquals(1, PendingUploadMeta.read(file).automaticAttempts)
        assertNull("claimed twice", claim(file))
    }

    @Test fun `undo leaves it due again`() {
        val file = recording()
        claim(file)!!.undo()
        assertEquals(failed(), PendingUploadMeta.read(file))
        assertNotNull(claim(file))
    }

    @Test fun `never sent to another account or when signed out`() {
        val file = recording()
        assertNull(claim(file, user = "user-2"))
        assertNull(claim(file, user = null))
        assertEquals(failed(), PendingUploadMeta.read(file))
    }

    @Test fun `an account is offered its own recordings and those with no recorded owner`() {
        val mine = recording("mine", PendingUploadMeta(owner = "user-1"))
        val theirs = recording("theirs", PendingUploadMeta(owner = "user-2"))
        val released = recording("released", meta = null)
        PendingUploadMeta.fileFor(released).writeText("title=Old\nduration=7\n")
        val bare = recording("bare", meta = null)
        val all = listOf(mine, theirs, released, bare)

        assertEquals(listOf(mine, released, bare), all.offeredTo("user-1"))
        assertEquals(listOf(theirs, released, bare), all.offeredTo("user-2"))
        assertEquals(listOf(released, bare), all.offeredTo(null))
        assertTrue("nothing is deleted", all.all { it.exists() })
    }

    @Test fun `waits between attempts and stops after the limit`() {
        assertNull(claim(recording("recent", failed(at = now - AutomaticUploadRetry.MIN_GAP_MS + 1))))
        assertNotNull(claim(recording("waited", failed(at = now - AutomaticUploadRetry.MIN_GAP_MS))))
        assertNull(claim(recording("spent", failed(attempts = AutomaticUploadRetry.MAX_ATTEMPTS))))
    }

    @Test fun `skips files that are not due`() {
        val spent = recording("spent", failed(attempts = AutomaticUploadRetry.MAX_ATTEMPTS))
        val due = recording("due")
        assertEquals(due, claim(spent, due)?.file)
    }

    @Test fun `network and server failures before the audio lands are worth retrying`() {
        fun http(code: Int) = HttpException(Response.error<Unit>(code, "".toResponseBody(null)))
        assertTrue(AutomaticUploadRetry.worthRetrying("create", IOException("offline"), null))
        assertTrue(AutomaticUploadRetry.worthRetrying("create", http(504), null))
        assertTrue(AutomaticUploadRetry.worthRetrying("storage_put", Exception("Upload failed: 504"), 504))
        assertTrue(AutomaticUploadRetry.worthRetrying("storage_put", IOException("reset"), null))
        assertTrue(AutomaticUploadRetry.worthRetrying("storage_put", Exception("Upload failed: 429"), 429))

        assertFalse(AutomaticUploadRetry.worthRetrying("create", http(403), null))
        assertFalse(AutomaticUploadRetry.worthRetrying("create", IllegalStateException("bad reply"), null))
        assertFalse(AutomaticUploadRetry.worthRetrying("storage_put", Exception("Upload failed: 413"), 413))
        // The audio is on the server: sending it again would make a second copy.
        assertFalse(AutomaticUploadRetry.worthRetrying("complete", IOException("offline"), null))
        assertFalse(AutomaticUploadRetry.worthRetrying("complete", http(504), null))
    }
}
