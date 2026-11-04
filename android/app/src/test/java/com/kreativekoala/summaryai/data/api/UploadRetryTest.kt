package com.kreativekoala.summaryai.data.api

import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.BufferedSink
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

class UploadRetryTest {

    private lateinit var server: MockWebServer
    private val sleeps = mutableListOf<Long>()
    private val diagnostics = mutableListOf<UploadDiagnostics>()

    @Before fun setUp() {
        server = MockWebServer().also { it.start() }
    }

    @After fun tearDown() {
        server.shutdown()
    }

    private fun uploader(client: OkHttpClient = OkHttpClient(), random: () -> Double = { 0.5 }) = RetryingUploader(
        client = client,
        policy = UploadRetryPolicy(random = random),
        sleep = { sleeps += it },
        onAttemptFailed = { diagnostics += it },
    )

    private fun singleAttemptUploader() = RetryingUploader(
        client = OkHttpClient(),
        policy = UploadRetryPolicy(maxAttempts = 1),
        onAttemptFailed = { diagnostics += it },
    )

    private fun putRequest(body: RequestBody = "audio".toRequestBody("audio/mp4".toMediaType())) =
        Request.Builder().url(server.url("/object/sign/b/f.m4a?token=SECRET")).put(body).build()

    private fun oneShotBody() = object : RequestBody() {
        override fun contentType(): MediaType = "audio/mp4".toMediaType()
        override fun writeTo(sink: BufferedSink) { sink.writeUtf8("audio") }
        override fun isOneShot() = true
    }

    private fun run(request: Request, uploader: RetryingUploader = uploader()) =
        runBlocking { uploader.execute(request, bytes = 5) }

    // ---- policy ----

    @Test fun `only 502 503 504 are retryable statuses`() {
        val p = UploadRetryPolicy()
        listOf(502, 503, 504).forEach { assertTrue("$it", p.isRetryableStatus(it)) }
        listOf(200, 400, 401, 403, 404, 408, 409, 413, 429, 500, 501).forEach { assertFalse("$it", p.isRetryableStatus(it)) }
    }

    @Test fun `timeouts are retryable, other IO failures are not`() {
        val p = UploadRetryPolicy()
        assertTrue(p.isRetryableFailure(SocketTimeoutException("Read timed out")))
        assertTrue(p.isRetryableFailure(InterruptedIOException("timeout")))
        assertTrue(p.isRetryableFailure(IOException("wrapped", SocketTimeoutException("x"))))
        assertFalse(p.isRetryableFailure(SocketException("Connection reset")))
        assertFalse(p.isRetryableFailure(IOException("Canceled")))
        assertFalse(p.isRetryableFailure(InterruptedIOException("interrupted")))
    }

    @Test fun `delays are 1s then 3s with bounded jitter`() {
        fun delays(r: Double) = UploadRetryPolicy(random = { r }).let { it.delayBeforeNextMs(1) to it.delayBeforeNextMs(2) }
        assertEquals(1000L to 3000L, delays(0.5))
        assertEquals(750L to 2250L, delays(0.0))
        assertEquals(1250L to 3750L, delays(1.0))
    }

    @Test fun `only a PUT with a replayable body can be retried`() {
        val p = UploadRetryPolicy()
        val url = "https://example.com/x"
        assertTrue(p.canReplay(Request.Builder().url(url).put("a".toRequestBody()).build()))
        assertFalse(p.canReplay(Request.Builder().url(url).put(oneShotBody()).build()))
        assertFalse(p.canReplay(Request.Builder().url(url).post("a".toRequestBody()).build()))
    }

    @Test fun `ProgressRequestBody keeps the delegate's replay flags`() {
        assertTrue(ProgressRequestBody(oneShotBody()) {}.isOneShot())
        assertFalse(ProgressRequestBody("a".toRequestBody()) {}.isOneShot())
    }

    // ---- executor ----

    @Test fun `504 then 504 then 200 succeeds on the third attempt`() {
        server.enqueue(MockResponse().setResponseCode(504))
        server.enqueue(MockResponse().setResponseCode(504))
        server.enqueue(MockResponse().setResponseCode(200))
        val response = run(putRequest())
        assertEquals(200, response.code)
        assertEquals(3, server.requestCount)
        assertEquals(listOf(1000L, 3000L), sleeps)
        assertEquals(listOf(1, 2), diagnostics.map { it.attempt })
        // Each retry re-sends the whole body.
        repeat(3) { assertEquals("audio", server.takeRequest().body.readUtf8()) }
    }

    @Test fun `502 and 503 are retried`() {
        server.enqueue(MockResponse().setResponseCode(502))
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setResponseCode(200))
        assertEquals(200, run(putRequest()).code)
        assertEquals(3, server.requestCount)
    }

    @Test fun `persistent 504 stops after 3 attempts and returns the 504`() {
        repeat(5) { server.enqueue(MockResponse().setResponseCode(504)) }
        val response = run(putRequest())
        assertEquals(504, response.code)
        assertEquals(3, server.requestCount)
        assertEquals(2, sleeps.size)
        assertEquals(listOf(1, 2, 3), diagnostics.map { it.attempt })
    }

    @Test fun `4xx is never retried`() {
        listOf(400, 401, 403, 404, 413).forEach { code ->
            sleeps.clear()
            val before = server.requestCount
            server.enqueue(MockResponse().setResponseCode(code))
            assertEquals(code, run(putRequest()).code)
            assertEquals("code $code", 1, server.requestCount - before)
            assertTrue(sleeps.isEmpty())
        }
    }

    @Test fun `500 is not retried`() {
        server.enqueue(MockResponse().setResponseCode(500))
        assertEquals(500, run(putRequest()).code)
        assertEquals(1, server.requestCount)
    }

    @Test fun `read timeout is retried then succeeds`() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        server.enqueue(MockResponse().setResponseCode(200))
        val client = OkHttpClient.Builder().readTimeout(300, TimeUnit.MILLISECONDS).build()
        assertEquals(200, run(putRequest(), uploader(client)).code)
        assertEquals(2, server.requestCount)
        assertEquals(1, sleeps.size)
        assertNotNull(diagnostics.single().errorClass)
        assertNull(diagnostics.single().status)
    }

    @Test fun `persistent timeout throws the original IOException after 3 attempts`() {
        repeat(3) { server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)) }
        val client = OkHttpClient.Builder().readTimeout(200, TimeUnit.MILLISECONDS).build()
        val thrown = runCatching { run(putRequest(), uploader(client)) }.exceptionOrNull()
        assertTrue("was $thrown", thrown is SocketTimeoutException)
        assertEquals(3, server.requestCount)
    }

    @Test fun `connection reset is not retried`() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val thrown = runCatching { run(putRequest()) }.exceptionOrNull()
        assertTrue(thrown is IOException)
        assertEquals(1, server.requestCount)
        assertTrue(sleeps.isEmpty())
    }

    @Test fun `one-shot body gets a single attempt even on 504`() {
        server.enqueue(MockResponse().setResponseCode(504))
        assertEquals(504, run(putRequest(oneShotBody())).code)
        assertEquals(1, server.requestCount)
    }

    // ---- diagnostics and redaction ----

    @Test fun `diagnostics carry host status and the four headers`() {
        server.enqueue(
            MockResponse().setResponseCode(504)
                .addHeader("Server", "cloudflare").addHeader("Via", "1.1 abc.cloudfront.net")
                .addHeader("CF-Ray", "8a1b2c3d4e5f-SJC").addHeader("X-Request-Id", "req-123")
        )
        runBlocking { singleAttemptUploader().execute(putRequest(), bytes = 5) }
        val d = diagnostics.single()
        assertEquals(server.hostName, d.host)
        assertEquals(504, d.status)
        assertEquals("cloudflare", d.server)
        assertEquals("1.1 abc.cloudfront.net", d.via)
        assertEquals("8a1b2c3d4e5f-SJC", d.cfRay)
        assertEquals("req-123", d.requestId)
        assertEquals(5L, d.bytes)
        assertTrue(d.durationMs >= 0)
    }

    @Test fun `logged fields never contain the signed URL, token, credentials or cookies`() {
        server.enqueue(
            MockResponse().setResponseCode(504).addHeader("Set-Cookie", "session=SECRETCOOKIE")
                .addHeader("Authorization", "Bearer SECRETBEARER")
        )
        val signed = server.url("/storage/v1/object/sign/audio/user-1/rec-1.m4a?token=SECRETTOKEN&X-Amz-Signature=SECRETSIG")
        val request = Request.Builder().url(signed).header("Authorization", "Bearer SECRETBEARER")
            .put("audio".toRequestBody()).build()
        runBlocking { singleAttemptUploader().execute(request, bytes = 5) }

        val d = diagnostics.single()
        assertEquals(server.hostName, d.host)
        val everything = d.toContext().toString() + d.toLogLine()
        listOf("SECRET", "token", "Signature", "?", "/storage", "rec-1", "Bearer", "session=").forEach {
            assertFalse("leaked '$it' in: $everything", everything.contains(it, ignoreCase = true))
        }
        assertEquals(setOf("stage", "attempts", "host", "status", "duration_ms", "bytes"), d.toContext().keys)
    }

    @Test fun `hostOf drops user info, port, path and query`() {
        val url = HttpUrl.Builder().scheme("https").host("abc.supabase.co").port(8443)
            .username("u").password("p4ss").addPathSegments("storage/v1/x").addQueryParameter("token", "T0K").build()
        assertEquals("abc.supabase.co", UploadDiagnostics.hostOf(url))
    }

    @Test fun `exception diagnostics record the class only, not the message`() {
        val url = HttpUrl.Builder().scheme("https").host("abc.supabase.co").addQueryParameter("token", "T0K").build()
        val d = UploadDiagnostics.fromException(
            "storage_put", 2, url, SocketTimeoutException("timeout for https://abc.supabase.co/x?token=T0K"), 1234, 99
        )
        assertEquals("SocketTimeoutException", d.errorClass)
        assertFalse(d.toContext().toString().contains("T0K"))
        assertEquals("1234", d.toContext()["duration_ms"])
        assertEquals("abc.supabase.co", d.host)
    }

    @Test fun `header values are capped`() {
        server.enqueue(MockResponse().setResponseCode(503).addHeader("Server", "x".repeat(500)))
        runBlocking { singleAttemptUploader().execute(putRequest(), bytes = 5) }
        assertEquals(120, diagnostics.single().server!!.length)
    }
}
