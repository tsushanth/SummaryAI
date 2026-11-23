package com.kreativekoala.summaryai.util

import android.content.Context
import androidx.annotation.StringRes
import com.google.gson.JsonParser
import com.kreativekoala.summaryai.R
import retrofit2.HttpException
import java.io.IOException

/**
 * Turns a failed call into text in the app's language. The backend answers errors as
 * `{ "error": { "code": "TODO_NOT_FOUND", "message": "<English>" } }`; the code is stable and the message is English
 * (for logs and for clients that do not know the code). Known codes map to string resources; an unknown code falls back
 * to the server message; a failure with no body falls back to its HTTP status, then to the exception message.
 */
object ApiErrors {
    data class Parsed(val status: Int?, val code: String?, val message: String?)

    private val byCode: Map<String, Int> = mapOf(
        // Specific codes (backend: Errors.* with an explicit code)
        "RECORDING_NOT_FOUND" to R.string.api_error_recording_not_found,
        "RECORDING_NOT_TRANSCRIBED" to R.string.api_error_recording_not_transcribed,
        "TRANSCRIPT_NOT_FOUND" to R.string.api_error_transcript_unavailable,
        "TRANSCRIPT_EMPTY" to R.string.api_error_transcript_unavailable,
        "QA_FAILED" to R.string.error_qa_failed,
        "QA_HISTORY_FAILED" to R.string.api_error_server,
        "TODO_NOT_FOUND" to R.string.api_error_todo_not_found,
        "TODO_LIST_FAILED" to R.string.api_error_server,
        "TODO_CREATE_FAILED" to R.string.api_error_server,
        "TODO_DELETE_FAILED" to R.string.api_error_server,
        "TODO_TOGGLE_FAILED" to R.string.api_error_server,
        "TODO_NO_UPDATES" to R.string.api_error_invalid_request,
        "SPEAKER_NAMES_UPDATE_FAILED" to R.string.api_error_server,
        "RECORDING_DELETE_FAILED" to R.string.api_error_server,
        "PROVIDER_NOT_CONFIGURED" to R.string.api_error_calendar_provider_unavailable,
        "CALENDAR_INVALID_PROVIDER" to R.string.api_error_invalid_request,
        // Generic codes
        "NOT_FOUND" to R.string.api_error_not_found,
        "RATE_LIMITED" to R.string.api_error_rate_limited,
        "UNAUTHORIZED" to R.string.api_error_unauthorized,
        "FORBIDDEN" to R.string.api_error_forbidden,
        "BAD_REQUEST" to R.string.api_error_invalid_request,
        "VALIDATION_ERROR" to R.string.api_error_invalid_request,
        "INVALID_JSON" to R.string.api_error_invalid_request,
        "INTERNAL_ERROR" to R.string.api_error_server,
    )

    /** Status, code and message of an HttpException's error body, without consuming the body. Non-HTTP failures parse to nulls. */
    fun parse(t: Throwable): Parsed {
        val http = t as? HttpException ?: return Parsed(null, null, null)
        val raw = runCatching { http.response()?.errorBody()?.source()?.peek()?.readUtf8() }.getOrNull()
        val error = runCatching { JsonParser.parseString(raw).asJsonObject.getAsJsonObject("error") }.getOrNull()
        val code = runCatching { error?.get("code")?.asString }.getOrNull()?.takeIf { it.isNotBlank() }
        val message = runCatching { error?.get("message")?.asString }.getOrNull()?.takeIf { it.isNotBlank() }
        return Parsed(http.code(), code, message)
    }

    /** The string resource for a stable error code, or null when the code is not known to this client. */
    @StringRes fun resForCode(code: String?): Int? = code?.let { byCode[it.uppercase()] }

    @StringRes private fun resForStatus(status: Int): Int = when {
        status == 401 -> R.string.api_error_unauthorized
        status == 403 -> R.string.api_error_forbidden
        status == 404 -> R.string.api_error_not_found
        status == 429 -> R.string.api_error_rate_limited
        status >= 500 -> R.string.api_error_server
        else -> R.string.api_error_invalid_request
    }

    /** The string resource to show for [t], or null to show its own message. */
    @StringRes fun resFor(t: Throwable): Int? {
        val p = parse(t)
        resForCode(p.code)?.let { return it }
        if (p.code != null && p.message != null) return null // unknown code with a server message: show that message
        if (p.status != null) return resForStatus(p.status)
        if (t is IOException) return R.string.api_error_network
        return null
    }

    /** Text for the user. Falls back to the server message for unknown codes, then to the exception's message. */
    fun userMessage(context: Context, t: Throwable): String? {
        resFor(t)?.let { return context.getString(it) }
        return parse(t).message ?: t.message
    }
}
