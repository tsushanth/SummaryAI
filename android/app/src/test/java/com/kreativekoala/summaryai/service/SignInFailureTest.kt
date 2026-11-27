package com.kreativekoala.summaryai.service

import io.github.jan.supabase.exceptions.HttpRequestException
import io.github.jan.supabase.gotrue.exception.AuthRestException
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.request.HttpRequestBuilder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class SignInFailureTest {

    private val timeout = HttpRequestTimeoutException("https://x.supabase.co/auth/v1/token?grant_type=id_token", 10_000L)
    private val noConnection = HttpRequestException("failed to connect", HttpRequestBuilder())
    private fun refused(status: Int = 400, code: String = "bad_jwt", detail: String = "Bad ID token") =
        AuthRestException(code, detail, status)

    @Test fun `the two failures seen from real phones count as unreachable`() {
        assertEquals(SignInFailure.Kind.UNREACHABLE, SignInFailure.kindOf(timeout))
        assertEquals(SignInFailure.Kind.UNREACHABLE, SignInFailure.kindOf(noConnection))
        assertEquals(SignInFailure.Kind.UNREACHABLE, SignInFailure.kindOf(IOException("reset")))
    }

    @Test fun `a server error is worth another try, a refusal is not`() {
        assertEquals(SignInFailure.Kind.UNREACHABLE, SignInFailure.kindOf(refused(status = 503)))
        assertEquals(SignInFailure.Kind.REJECTED, SignInFailure.kindOf(refused(status = 400)))
        assertEquals(SignInFailure.Kind.REJECTED, SignInFailure.kindOf(refused(status = 429)))
        assertEquals(SignInFailure.Kind.UNKNOWN, SignInFailure.kindOf(IllegalStateException("x")))
    }

    @Test fun `an exchange that gets through on the third try succeeds, after the waits`() = runTest {
        var tries = 0
        val result = SignInFailure.retryUnreachable(now = { currentTime }) {
            if (++tries < 3) throw timeout
            "signed in"
        }
        assertEquals("signed in", result)
        assertEquals(3, tries)
        assertEquals(4_000L, currentTime)
    }

    @Test fun `it gives up after two retries and passes the failure on`() = runTest {
        var tries = 0
        val thrown = runCatching { SignInFailure.retryUnreachable(now = { currentTime }) { tries++; throw noConnection } }.exceptionOrNull()
        assertEquals(noConnection, thrown)
        assertEquals(3, tries)
    }

    @Test fun `a refusal is not sent again`() = runTest {
        var tries = 0
        val thrown = runCatching { SignInFailure.retryUnreachable { tries++; throw refused() } }.exceptionOrNull()
        assertTrue(thrown is AuthRestException)
        assertEquals(1, tries)
    }

    @Test fun `no further try starts once the person has waited too long`() = runTest {
        var clock = 0L
        var tries = 0
        runCatching {
            SignInFailure.retryUnreachable(now = { clock }) { tries++; clock += SignInFailure.RETRY_BUDGET_MS; throw timeout }
        }
        assertEquals(1, tries)
    }

    @Test fun `cancelling is not retried`() {
        var tries = 0
        assertThrows(CancellationException::class.java) {
            runTest { SignInFailure.retryUnreachable { tries++; throw CancellationException("left the screen") } }
        }
        assertEquals(1, tries)
    }

    @Test fun `a refusal reports the server's status, code and reason`() {
        val context = SignInFailure.reportContext(refused(detail = "Unacceptable audience in id_token"), tries = 1, elapsedMs = 250)
        assertEquals("AuthRestException", context["error"])
        assertEquals("REJECTED", context["kind"])
        assertEquals("400", context["status"])
        assertEquals("bad_jwt", context["code"])
        assertEquals("Unacceptable audience in id_token", context["detail"])
        assertEquals("1", context["tries"])
        assertEquals("250", context["ms"])
    }

    @Test fun `a report never carries an address, a link or a token`() {
        // Shaped like a token but made up, and joined here so secret scanners do not take the source for a real one.
        val madeUpToken = listOf("ey" + "JhbGciOiJub25lIn0", "ey" + "JmYWtlIjp0cnVlfQ", "notasignature").joinToString(".")
        val detail = "user person@example.com token $madeUpToken at https://x.supabase.co/auth?apikey=1"
        val context = SignInFailure.reportContext(refused(detail = detail), 1, 1)
        val sent = context.values.joinToString(" ")
        assertFalse(sent, sent.contains("@"))
        assertFalse(sent, sent.contains("eyJ"))
        assertFalse(sent, sent.contains("http"))
    }

    @Test fun `closing the Google picker is not a failure, a configuration error is`() {
        for (status in listOf(12501, 12502, 16)) assertTrue(SignInFailure.isGoogleCancel(status))
        for (status in listOf(7, 8, 10, 12500)) assertFalse(SignInFailure.isGoogleCancel(status))
    }
}
