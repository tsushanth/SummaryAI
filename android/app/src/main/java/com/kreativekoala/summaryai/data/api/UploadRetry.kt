package com.kreativekoala.summaryai.data.api

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException
import java.io.InterruptedIOException
import kotlin.random.Random

/**
 * When an upload PUT may be sent again. At most [maxAttempts] attempts in total, waiting [baseDelaysMs] (1 s, then
 * 3 s) plus or minus [jitterFraction] between them. Retries 502/503/504, timeouts and transient connection
 * failures (see [isRetryableFailure]); never 4xx.
 */
class UploadRetryPolicy(
    val maxAttempts: Int = 3,
    private val baseDelaysMs: List<Long> = listOf(1_000L, 3_000L),
    private val jitterFraction: Double = 0.25,
    private val random: () -> Double = { Random.nextDouble() },
) {
    fun isRetryableStatus(code: Int): Boolean = code == 502 || code == 503 || code == 504

    /**
     * True for transient failures an idempotent, replayable PUT can safely repeat: timeouts, and connection-level
     * breakage (ProtocolException such as "unexpected end of stream", SocketException such as connection
     * reset / broken pipe / abort, EOFException, HTTP/2 stream reset, connection shutdown). Looks through up to
     * [MAX_CAUSE_DEPTH] causes. Anything on the never-retry list anywhere in the chain wins: unknown host,
     * certificate / TLS identity failures, coroutine cancellation, a non-timeout interrupt or "Canceled".
     */
    fun isRetryableFailure(e: IOException): Boolean {
        if (Thread.currentThread().isInterrupted) return false
        val chain = generateSequence<Throwable>(e) { it.cause }.take(MAX_CAUSE_DEPTH).toList()
        if (chain.any(::isNeverRetry)) return false
        return chain.any(::isTransient)
    }

    private fun isNeverRetry(t: Throwable): Boolean =
        t is java.net.UnknownHostException ||
            t is javax.net.ssl.SSLPeerUnverifiedException ||
            t is java.security.cert.CertificateException ||
            t is java.security.cert.CertPathValidatorException ||
            t is CancellationException ||
            (t is InterruptedIOException && t !is java.net.SocketTimeoutException && !hasTimeoutMessage(t)) ||
            t.message.equals("Canceled", ignoreCase = true)

    private fun isTransient(t: Throwable): Boolean =
        t is java.net.SocketTimeoutException ||
            // OkHttp's call/connect/write timeouts surface as InterruptedIOException("timeout").
            (t is InterruptedIOException && hasTimeoutMessage(t)) ||
            t is java.net.ProtocolException ||
            t is java.net.SocketException ||
            t is java.io.EOFException ||
            // OkHttp's own classes live in okhttp3.internal; match by name so a version change cannot break the build.
            t.javaClass.simpleName in TRANSIENT_OKHTTP_CLASS_NAMES

    private fun hasTimeoutMessage(t: Throwable) = t.message?.contains("timeout", ignoreCase = true) == true

    /** Only an idempotent PUT whose body can be written again (a file, not a stream or one-shot body). */
    fun canReplay(request: Request): Boolean {
        if (request.method != "PUT") return false
        val body = request.body ?: return true
        return !body.isOneShot() && !body.isDuplex()
    }

    /** Delay before the next attempt, given how many attempts have been made so far (1-based). */
    fun delayBeforeNextMs(attemptsMade: Int): Long {
        val base = baseDelaysMs[(attemptsMade - 1).coerceIn(0, baseDelaysMs.lastIndex)]
        val jitter = 1.0 + (random() * 2.0 - 1.0) * jitterFraction
        return (base * jitter).toLong()
    }

    private companion object {
        const val MAX_CAUSE_DEPTH = 4
        val TRANSIENT_OKHTTP_CLASS_NAMES = setOf("StreamResetException", "ConnectionShutdownException")
    }
}

/**
 * Executes the storage PUT with [UploadRetryPolicy]. On the last attempt it returns the response (or throws the
 * IOException) exactly as a single call would, so callers keep their existing failure handling. Every failed
 * attempt is reported to [onAttemptFailed] as [UploadDiagnostics].
 */
class RetryingUploader(
    private val client: OkHttpClient,
    private val policy: UploadRetryPolicy = UploadRetryPolicy(),
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val nanoTime: () -> Long = System::nanoTime,
    private val stage: String = "storage_put",
    private val onAttemptFailed: (UploadDiagnostics) -> Unit = {},
) {
    suspend fun execute(request: Request, bytes: Long): Response {
        val maxAttempts = if (policy.canReplay(request)) policy.maxAttempts else 1
        var attempt = 0
        while (true) {
            attempt++
            val started = nanoTime()
            val response = try {
                client.newCall(request).execute()
            } catch (e: IOException) {
                val elapsed = (nanoTime() - started) / 1_000_000
                onAttemptFailed(UploadDiagnostics.fromException(stage, attempt, request.url, e, elapsed, bytes))
                if (attempt < maxAttempts && policy.isRetryableFailure(e)) {
                    sleep(policy.delayBeforeNextMs(attempt))
                    continue
                }
                throw e
            }
            if (response.isSuccessful) return response
            val elapsed = (nanoTime() - started) / 1_000_000
            onAttemptFailed(UploadDiagnostics.fromResponse(stage, attempt, response, elapsed, bytes))
            if (attempt < maxAttempts && policy.isRetryableStatus(response.code)) {
                response.close()
                sleep(policy.delayBeforeNextMs(attempt))
                continue
            }
            return response
        }
    }
}
