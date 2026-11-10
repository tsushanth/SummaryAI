package com.kreativekoala.summaryai.data.api

import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.internal.http2.ConnectionShutdownException
import okhttp3.internal.http2.ErrorCode
import okhttp3.internal.http2.StreamResetException
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
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

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

    @Test fun `timeouts are retryable, unrelated IO failures are not`() {
        val p = UploadRetryPolicy()
        assertTrue(p.isRetryableFailure(SocketTimeoutException("Read timed out")))
        assertTrue(p.isRetryableFailure(InterruptedIOException("timeout")))
        assertTrue(p.isRetryableFailure(IOException("wrapped", SocketTimeoutException("x"))))
        assertFalse(p.isRetryableFailure(IOException("Canceled")))
        assertFalse(p.isRetryableFailure(IOException("disk full")))
        assertFalse(p.isRetryableFailure(InterruptedIOException("interrupted")))
    }

    @Test fun `transient connection-level failures are retryable`() {
        val p = UploadRetryPolicy()
        val retryable = mapOf<String, IOException>(
            "ProtocolException" to ProtocolException("unexpected end of stream"),
            "SocketException reset" to SocketException("Connection reset"),
            "SocketException broken pipe" to SocketException("Broken pipe"),
            "SocketException abort" to SocketException("Software caused connection abort"),
            "ConnectException" to ConnectException("Failed to connect"),
            "EOFException" to EOFException("\\n not found: limit=0"),
            "StreamResetException" to StreamResetException(ErrorCode.INTERNAL_ERROR),
            "ConnectionShutdownException" to ConnectionShutdownException(),
        )
        retryable.forEach { (name, e) -> assertTrue(name, p.isRetryableFailure(e)) }
    }

    @Test fun `OkHttp exception types are matched by simple name`() {
        // Guards the name-based match used so an OkHttp upgrade that moves or hides these classes cannot break the build.
        assertEquals("StreamResetException", StreamResetException(ErrorCode.CANCEL).javaClass.simpleName)
        assertEquals("ConnectionShutdownException", ConnectionShutdownException().javaClass.simpleName)
        class StreamResetException : IOException("stream was reset: CANCEL")
        assertTrue(UploadRetryPolicy().isRetryableFailure(StreamResetException()))
    }

    @Test fun `unknown host, certificate errors, cancellation and interrupts are never retried`() {
        val p = UploadRetryPolicy()
        val notRetryable = mapOf<String, Throwable>(
            "UnknownHostException" to UnknownHostException("abc.supabase.co"),
            "SSLPeerUnverifiedException" to SSLPeerUnverifiedException("Hostname not verified"),
            "CertificateException" to CertificateException("expired"),
            "SSLHandshakeException with cert cause" to SSLHandshakeException("PKIX failed").also { it.initCause(CertificateException("x")) },
            "Canceled" to IOException("Canceled"),
            "interrupted, not a timeout" to InterruptedIOException("interrupted"),
            "CancellationException cause" to IOException("wrapped", CancellationException("job cancelled")),
        )
        notRetryable.forEach { (name, e) -> assertFalse(name, p.isRetryableFailure(e as? IOException ?: IOException("wrapped", e))) }
    }

    @Test fun `a never-retry cause wins over a retryable one in the same chain`() {
        val p = UploadRetryPolicy()
        assertFalse(p.isRetryableFailure(SocketException("Connection reset").also { it.initCause(UnknownHostException("h")) }))
        assertFalse(p.isRetryableFailure(IOException("outer", SSLPeerUnverifiedException("bad cert").also { it.initCause(SocketException("reset")) })))
    }

    @Test fun `retryable cause nested up to 4 deep is found, deeper is not`() {
        val p = UploadRetryPolicy()
        val reset = SocketException("Connection reset")
        val depth4 = IOException("a", IOException("b", IOException("c", reset)))      // reset is 4th in the chain
        val depth5 = IOException("a", IOException("b", IOException("c", IOException("d", reset))))
        assertTrue(p.isRetryableFailure(depth4))
        assertFalse(p.isRetryableFailure(depth5))
        assertTrue(p.isRetryableFailure(IOException("wrapper", ProtocolException("unexpected end of stream"))))
        assertTrue(p.isRetryableFailure(IOException("wrapper", IOException("inner", EOFException()))))
    }

    @Test fun `an interrupted thread is never retried even for a retryable exception`() {
        val p = UploadRetryPolicy()
        Thread.currentThread().interrupt()
        try {
            assertFalse(p.isRetryableFailure(SocketException("Connection reset")))
            assertFalse(p.isRetryableFailure(SocketTimeoutException("Read timed out")))
        } finally {
            Thread.interrupted() // clear the flag for other tests
        }
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

    @Test fun `connection dropped at start is retried then succeeds`() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        server.enqueue(MockResponse().setResponseCode(200))
        assertEquals(200, run(putRequest()).code)
        assertEquals(2, server.requestCount)
        assertEquals(listOf(1000L), sleeps)
        assertNull(diagnostics.single().status)
        assertNotNull(diagnostics.single().errorClass)
    }

    @Test fun `connection closed after the body without a response is retried and the retry re-sends the whole body`() {
        val big = "x".repeat(2_000_000)
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST))
        server.enqueue(MockResponse().setResponseCode(200))
        val client = OkHttpClient.Builder().retryOnConnectionFailure(false).build()
        assertEquals(200, run(putRequest(big.toRequestBody("audio/mp4".toMediaType())), uploader(client)).code)
        assertEquals(2, server.requestCount)
        assertEquals(listOf(1000L), sleeps)
        // OkHttp reports this as IOException("unexpected end of stream ...") with an EOFException cause, so this
        // also covers the nested-cause path end to end.
        assertNull(diagnostics.single().status)
        repeat(2) { assertEquals(big.length, server.takeRequest().body.readUtf8().length) }
    }

    @Test fun `persistent connection drop throws the original IOException after 3 attempts`() {
        val client = OkHttpClient.Builder().retryOnConnectionFailure(false).build()
        repeat(3) { server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)) }
        val thrown = runCatching { run(putRequest(), uploader(client)) }.exceptionOrNull()
        assertTrue("was $thrown", thrown is IOException)
        assertEquals(3, server.requestCount)
        assertEquals(listOf(1000L, 3000L), sleeps)
        assertEquals(listOf(1, 2, 3), diagnostics.map { it.attempt })
    }

    @Test fun `a one-shot body is not retried after a connection drop`() {
        val client = OkHttpClient.Builder().retryOnConnectionFailure(false).build()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        server.enqueue(MockResponse().setResponseCode(200))
        val thrown = runCatching { run(putRequest(oneShotBody()), uploader(client)) }.exceptionOrNull()
        assertTrue("was $thrown", thrown is IOException)
        assertEquals(1, server.requestCount)
        assertTrue(sleeps.isEmpty())
    }

    @Test fun `a POST is not retried after a connection drop`() {
        val client = OkHttpClient.Builder().retryOnConnectionFailure(false).build()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        val post = Request.Builder().url(server.url("/x")).post("a".toRequestBody()).build()
        assertTrue(runCatching { run(post, uploader(client)) }.exceptionOrNull() is IOException)
        assertEquals(1, server.requestCount)
        assertTrue(sleeps.isEmpty())
    }

    @Test fun `unknown host is not retried`() {
        val request = Request.Builder().url("http://no-such-host.invalid/x").put("a".toRequestBody()).build()
        val thrown = runCatching { run(request) }.exceptionOrNull()
        assertTrue("was $thrown", thrown is java.net.UnknownHostException)
        assertTrue(sleeps.isEmpty())
        assertEquals(1, diagnostics.size)
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
