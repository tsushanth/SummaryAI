package com.kreativekoala.summaryai.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Date and time text for display, in the order and with the month names, 12/24 hour clock and separators the
 * user's language expects. Use it instead of `SimpleDateFormat("h:mm a", Locale.US)`, which shows a 12 hour clock
 * and English month names to every user. Parsing of server dates must keep using fixed patterns with Locale.US.
 */
object LocaleDates {
    /** `h:mm a` in English, `HH:mm` in Russian. */
    const val TIME = "jm"
    /** `MMM d` in English, `d MMM` in Russian. */
    const val MONTH_DAY = "MMMd"
    /** `MMM d, h:mm a` in English. */
    const val MONTH_DAY_TIME = "MMMdjm"
    /** `MMM d, y` in English. */
    const val DATE_MEDIUM = "yMMMd"
    /** Short numeric date with year. */
    const val DATE_NUMERIC = "yMd"
    /** Stand-alone month name, for headings. */
    const val MONTH_NAME = "LLLL"

    /** Formats [date] with the best pattern for [skeleton] in [locale]; [fallback] is used where the platform cannot answer (plain JVM tests). */
    fun format(date: Date, skeleton: String, fallback: String, locale: Locale = Locale.getDefault()): String {
        val pattern = try {
            android.text.format.DateFormat.getBestDateTimePattern(locale, skeleton)
        } catch (e: Throwable) {
            null
        }
        return SimpleDateFormat(if (pattern.isNullOrEmpty()) fallback else pattern, locale).format(date)
    }

    fun time(date: Date) = format(date, TIME, "h:mm a")
    fun monthDay(date: Date) = format(date, MONTH_DAY, "MMM d")
    fun monthDayTime(date: Date) = format(date, MONTH_DAY_TIME, "MMM d, h:mm a")
    fun dateMedium(date: Date) = format(date, DATE_MEDIUM, "MMM d, yyyy")
    fun dateNumeric(date: Date) = format(date, DATE_NUMERIC, "MM/dd/yy")
    fun weekdayMonthDayTime(date: Date) = format(date, "EEEMMMdjm", "EEE, MMM d, h:mm a")
    fun monthName(date: Date) = format(date, MONTH_NAME, "MMMM")

    /** Stand-alone month name with year ("September 2026" in English) for [month] (1-12) of [year]. */
    fun monthYear(year: Int, month: Int): String {
        val cal = java.util.Calendar.getInstance().apply { clear(); set(year, month - 1, 1) }
        return format(cal.time, "yLLLL", "LLLL yyyy")
    }
}
