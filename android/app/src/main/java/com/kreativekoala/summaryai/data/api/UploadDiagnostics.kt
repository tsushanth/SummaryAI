package com.kreativekoala.summaryai.data.api

import okhttp3.HttpUrl
import okhttp3.Response

/**
 * What we record about one failed upload request so a 5xx can be traced to a hop (CDN, proxy, origin).
 *
 * Deliberately narrow: the host only (never the path or query, which carry the signed token), the status or the
 * exception class (never its message), four named response headers, timing and size. Nothing from the request
 * (headers, body) is read.
 */
data class UploadDiagnostics(
    val stage: String,
    val attempt: Int,
    val host: String,
    val status: Int?,
    val errorClass: String?,
    val server: String?,
    val via: String?,
    val cfRay: String?,
    val requestId: String?,
    val durationMs: Long,
    val bytes: Long,
) {
    /** Key/value pairs for FailureReporter.context. Only non-null fields are included. */
    fun toContext(): Map<String, String> = buildMap {
        put("stage", stage)
        put("attempts", attempt.toString())
        put("host", host)
        status?.let { put("status", it.toString()) }
        errorClass?.let { put("error", it) }
        server?.let { put("server", it) }
        via?.let { put("via", it) }
        cfRay?.let { put("cf_ray", it) }
        requestId?.let { put("request_id", it) }
        put("duration_ms", durationMs.toString())
        put("bytes", bytes.toString())
    }

    fun toLogLine(): String = toContext().entries.joinToString(" ") { "${it.key}=${it.value}" }

    companion object {
        private const val MAX_HEADER_CHARS = 120

        /** Host only: no scheme, user info, port, path or query. */
        fun hostOf(url: HttpUrl): String = url.host

        fun fromResponse(stage: String, attempt: Int, response: Response, durationMs: Long, bytes: Long) =
            UploadDiagnostics(
                stage = stage,
                attempt = attempt,
                host = hostOf(response.request.url),
                status = response.code,
                errorClass = null,
                server = header(response, "Server"),
                via = header(response, "Via"),
                cfRay = header(response, "CF-Ray"),
                requestId = header(response, "X-Request-Id"),
                durationMs = durationMs,
                bytes = bytes,
            )

        fun fromException(stage: String, attempt: Int, url: HttpUrl, e: Throwable, durationMs: Long, bytes: Long) =
            UploadDiagnostics(
                stage = stage,
                attempt = attempt,
                host = hostOf(url),
                status = null,
                errorClass = e.javaClass.simpleName,
                server = null, via = null, cfRay = null, requestId = null,
                durationMs = durationMs,
                bytes = bytes,
            )

        private fun header(response: Response, name: String): String? =
            response.header(name)
                ?.filter { it.code in 32..126 }
                ?.trim()
                ?.take(MAX_HEADER_CHARS)
                ?.ifEmpty { null }
    }
}
