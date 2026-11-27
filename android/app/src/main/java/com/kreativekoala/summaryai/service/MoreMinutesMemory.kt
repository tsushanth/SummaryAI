package com.kreativekoala.summaryai.service

import android.content.SharedPreferences
import java.time.YearMonth
import java.time.ZoneOffset

/**
 * Remembers on this device that an account asked for more call minutes, until that month is over, so it is not asked
 * again. The month is the UTC calendar month, the one the server counts free minutes in.
 */
class MoreMinutesMemory(
    private val prefs: SharedPreferences,
    private val account: () -> String?,
    private val month: () -> String = { YearMonth.now(ZoneOffset.UTC).toString() }
) {
    fun askedThisMonth(): Boolean = prefs.getString(key(), null) == month()

    fun remember() = prefs.edit().putString(key(), month()).apply()

    private fun key() = "asked_in_" + account().orEmpty()

    companion object { const val PREFS_NAME = "phone_more_minutes" }
}
