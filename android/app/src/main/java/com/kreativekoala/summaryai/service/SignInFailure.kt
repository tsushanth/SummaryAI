package com.kreativekoala.summaryai.service

import io.github.jan.supabase.exceptions.HttpRequestException
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.gotrue.exception.AuthRestException
import kotlinx.coroutines.delay
import java.io.IOException

/** What stopped a sign-in and what to do about it. No Android types, so it is unit tested. */
object SignInFailure {
    enum class Kind {
        /** No usable answer from the sign-in server: no connection, a timeout, or a server error. Worth another try. */
        UNREACHABLE,
        /** The sign-in server answered and said no. The same request gets the same answer. */
        REJECTED,
        UNKNOWN
    }

    /** Waits before the second and third try. */
    val RETRY_DELAYS_MS = listOf(1_000L, 3_000L)
    /** No further try starts after this long: the user is watching a spinner. */
    const val RETRY_BUDGET_MS = 30_000L

    fun kindOf(t: Throwable): Kind = when {
        // HttpRequestTimeoutException is an IOException; connection failures arrive as HttpRequestException.
        t is HttpRequestException || t is IOException -> Kind.UNREACHABLE
        t is RestException -> if (t.statusCode >= 500) Kind.UNREACHABLE else Kind.REJECTED
        else -> Kind.UNKNOWN
    }

    /**
     * Runs [block] again while the sign-in server cannot be reached. Sending the same Google ID token twice is safe: a
     * first try that did arrive only leaves one more session behind.
     */
    suspend fun <T> retryUnreachable(
        delaysMs: List<Long> = RETRY_DELAYS_MS,
        budgetMs: Long = RETRY_BUDGET_MS,
        now: () -> Long = System::currentTimeMillis,
        block: suspend () -> T
    ): T {
        val started = now()
        var tries = 0
        while (true) {
            try {
                return block()
            } catch (e: Exception) {
                if (kindOf(e) != Kind.UNREACHABLE || tries >= delaysMs.size || now() - started >= budgetMs) throw e
                delay(delaysMs[tries++])
            }
        }
    }

    /** The server's own error code for a refusal ("bad_jwt", "over_request_rate_limit"), safe to show and to report. */
    fun serverCode(t: Throwable): String? {
        val rest = t as? RestException ?: return null
        return rest.error.replace(Regex("[^A-Za-z0-9_.-]"), "").take(60).ifEmpty { null } ?: "HTTP_${rest.statusCode}"
    }

    /** What a failure report says about a refused or unreachable sign-in. No address, token or account detail. */
    fun reportContext(t: Throwable, tries: Int, elapsedMs: Long): Map<String, String> = buildMap {
        put("error", t.javaClass.simpleName)
        put("kind", kindOf(t).name)
        put("tries", tries.toString())
        put("ms", elapsedMs.toString())
        if (t is RestException) {
            put("status", t.statusCode.toString())
            serverCode(t)?.let { put("code", it) }
            // For an auth refusal the server's own sentence is the message. Other REST errors put the request headers in
            // their message, so only their description is used. Empty means the reply did not come with a reason.
            put("detail", scrub((if (t is AuthRestException) t.message else t.description).orEmpty()))
        }
    }

    private fun scrub(text: String): String = text
        .replace(Regex("https?://\\S+"), "<url>")
        .replace(Regex("[\\w.+-]+@[\\w-]+\\.[\\w.-]+"), "<email>")
        .replace(Regex("eyJ[A-Za-z0-9_-]*(\\.[A-Za-z0-9_-]+)*"), "<token>")
        .replace(Regex("[A-Za-z0-9_-]{24,}(\\.[A-Za-z0-9_-]+)*"), "<token>")
        .replace(Regex("\\s+"), " ")
        .take(120)

    /** Google Play services status codes that mean the person closed the picker or a sign-in is already open. */
    fun isGoogleCancel(status: Int): Boolean = status == 12501 || status == 12502 || status == 16

    /** CommonStatusCodes.NETWORK_ERROR */
    const val GOOGLE_NETWORK_ERROR = 7
}
