package com.kreativekoala.summaryai.ui.calendar

import androidx.annotation.StringRes
import com.kreativekoala.summaryai.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI
import java.net.URLDecoder
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What the browser brought back after a calendar sign-in:
 * `summaryai://calendar/connected?provider=..` or `summaryai://calendar/error?message=<code>`.
 */
sealed interface CalendarReturn {
    data class Connected(val provider: String?) : CalendarReturn
    data class Failed(val code: String) : CalendarReturn

    companion object {
        /**
         * Null for any other link. Any app can open this link, so nothing from it is ever shown as text: the provider is
         * one of two known names and the code only picks one of our own messages. The email in the link is ignored.
         */
        fun parse(link: String?): CalendarReturn? {
            val uri = link?.let { runCatching { URI(it) }.getOrNull() } ?: return null
            if (uri.scheme != "summaryai" || uri.host != "calendar") return null
            fun query(name: String): String? = uri.rawQuery?.split('&')
                ?.firstOrNull { it.substringBefore('=') == name }
                ?.let { runCatching { URLDecoder.decode(it.substringAfter('=', ""), "UTF-8") }.getOrNull() }
            return when (uri.path) {
                "/connected" -> Connected(query("provider")?.takeIf { it == "google" || it == "microsoft" })
                "/error" -> Failed(query("message").orEmpty())
                else -> null
            }
        }

        /** The message for an error code the server puts on the link; codes it does not know get the general one. */
        @StringRes fun errorMessage(code: String): Int = when (code) {
            "access_denied" -> R.string.calendar_return_cancelled
            "invalid_state", "state_expired" -> R.string.calendar_return_expired
            "admin_consent_required", "consent_required" -> R.string.calendar_return_admin_approval
            else -> R.string.calendar_return_failed
        }
    }
}

/** Holds the result from the moment the link opens the app until the calendar screen has shown it. */
@Singleton
class CalendarReturnStore @Inject constructor() {
    private val _pending = MutableStateFlow<CalendarReturn?>(null)
    val pending: StateFlow<CalendarReturn?> = _pending.asStateFlow()

    /** Takes the link the app was opened with; links that are not a calendar result are ignored. */
    fun offer(link: String?) {
        CalendarReturn.parse(link)?.let { _pending.value = it }
    }

    fun consume() {
        _pending.value = null
    }
}
