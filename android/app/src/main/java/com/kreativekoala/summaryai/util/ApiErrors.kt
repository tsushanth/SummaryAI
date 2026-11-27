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
        // Phone calls
        "PHONE_COUNTRY_CODE_REQUIRED" to R.string.phone_error_country_code,
        "PHONE_INVALID_NUMBER" to R.string.phone_error_invalid_number,
        "PHONE_COUNTRY_NOT_SUPPORTED" to R.string.phone_error_country_unsupported,
        "PHONE_NUMBER_NOT_ALLOWED" to R.string.phone_error_number_not_allowed,
        "PHONE_VERIFY_TOO_SOON" to R.string.phone_error_too_soon,
        "PHONE_VERIFY_LIMIT" to R.string.phone_error_verify_limit,
        "PHONE_VERIFY_NUMBER_LIMIT" to R.string.phone_error_verify_limit,
        "PHONE_VERIFY_NUMBER_BUSY" to R.string.phone_error_number_busy,
        "PHONE_VERIFY_UNAVAILABLE" to R.string.phone_error_unavailable,
        "PHONE_VERIFY_CALL_FAILED" to R.string.phone_error_verify_call_failed,
        "PHONE_NUMBER_IN_USE" to R.string.phone_error_number_in_use,
        "PHONE_ALREADY_VERIFIED" to R.string.phone_error_already_verified,
        "PHONE_TOO_MANY_NUMBERS" to R.string.phone_error_too_many_numbers,
        "PHONE_REMOVE_FAILED" to R.string.phone_error_remove_failed,
        "PHONE_BUDGET_USED" to R.string.phone_service_used_up,
        "PHONE_MINUTES_USED" to R.string.phone_error_minutes_used,
        "PHONE_CALL_IN_PROGRESS" to R.string.phone_error_call_in_progress,
        "PHONE_CALL_LIMIT" to R.string.phone_error_call_limit,
        "PHONE_DESTINATION_LIMIT" to R.string.phone_error_destination_limit,
        "PHONE_CALLS_BUSY" to R.string.phone_error_unavailable,
        "PHONE_NOT_CONFIGURED" to R.string.phone_error_unavailable,
        "FEATURE_DISABLED" to R.string.phone_error_unavailable,
        "PHONE_NOT_VERIFIED" to R.string.error_verify_phone_first,
        "PHONE_CONSENT_REQUIRED" to R.string.phone_error_update_app,
        "APP_UPDATE_REQUIRED" to R.string.phone_error_update_app,
        "PHONE_ACCOUNT_NOT_ELIGIBLE" to R.string.phone_error_account,
        // Own number and phone agent
        "PHONE_TRIAL_USED" to R.string.phone_error_trial_used,
        "PHONE_TRIAL_FULL" to R.string.phone_error_trial_full,
        "PHONE_TRIAL_CONFIRM_REQUIRED" to R.string.api_error_invalid_request,
        "PHONE_NO_NUMBER_FOUND" to R.string.phone_error_no_number_found,
        "PHONE_NUMBER_PENDING" to R.string.phone_error_number_pending,
        "PHONE_NUMBERS_UNAVAILABLE" to R.string.phone_error_number_failed,
        "PHONE_NUMBER_NOT_FOUND" to R.string.api_error_not_found,
        "PHONE_NUMBER_REQUIRED" to R.string.api_error_invalid_request,
        "PHONE_NUMBER_PAID" to R.string.api_error_invalid_request,
        "PHONE_AGENT_FAILED" to R.string.phone_error_agent_failed,
        "PHONE_AGENT_UNAVAILABLE" to R.string.phone_error_agent_failed,
        "PHONE_AGENT_NOT_FOUND" to R.string.api_error_not_found,
        "PHONE_AGENT_PROMPT_LENGTH" to R.string.api_error_invalid_request,
        "PHONE_AGENT_PROMPT_NOT_ALLOWED" to R.string.phone_error_agent_not_allowed,
        "PHONE_AGENT_LANGUAGE" to R.string.phone_error_agent_language,
        "PHONE_AGENT_LIMIT" to R.string.phone_error_agent_limit,
        "PHONE_PURCHASE_OFF" to R.string.phone_error_unavailable,
        "PHONE_SUBSCRIPTION_REQUIRED" to R.string.phone_error_unavailable,
        "PHONE_PURCHASE_INVALID" to R.string.phone_error_purchase,
        "PHONE_PURCHASE_NOT_CHECKED" to R.string.phone_error_purchase,
        "PHONE_PURCHASE_IN_USE" to R.string.phone_error_purchase_in_use,
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

    /**
     * The server's own words for a request it refused as wrong (HTTP 400), when it says more than "bad request" would:
     * a rejected meeting link is explained ("Unsupported meeting platform..."). English, as the server writes it.
     * Null for every other failure, which keeps [userMessage].
     */
    fun refusalMessage(t: Throwable): String? = parse(t).takeIf { it.status == 400 }?.message

    /** Text for the user. Falls back to the server message for unknown codes, then to the exception's message. */
    fun userMessage(context: Context, t: Throwable): String? {
        resFor(t)?.let { return appLocaleContext(context).getString(it) }
        return parse(t).message ?: t.message
    }
}
