package com.kreativekoala.summaryai.util

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Date

/**
 * The one place that reads server timestamps. The server's times are UTC ISO-8601 strings, usually ending `+00:00`.
 * An explicit offset or `Z` is honoured; a timestamp without either is UTC. Never parse a server time with a
 * pattern that stops at the seconds: the device then reads UTC as local time.
 *
 * Date-only values (`2026-11-27`) are not instants and parse to null here, so they are never moved to another day.
 * Todo due dates are date-only in meaning even when the server sends them as midnight UTC: keep reading their first
 * ten characters, do not pass them through this object.
 */
object ServerTime {
    private val TIMESTAMP = Regex(
        """(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)([Zz]|[+-]\d{2}(?::?\d{2})?)?"""
    )

    /** The moment [value] names, or null when it is missing, date-only or not a timestamp. */
    fun parse(value: String?): Instant? {
        val match = TIMESTAMP.matchEntire(value?.trim() ?: return null) ?: return null
        val (day, time, offset) = match.destructured
        return runCatching {
            LocalDateTime.of(LocalDate.parse(day), LocalTime.parse(time))
                .toInstant(if (offset.isEmpty()) ZoneOffset.UTC else ZoneOffset.of(offset.uppercase()))
        }.getOrNull()
    }

    /** [parse] as a [Date], for [LocaleDates], which shows it in the device's time zone. */
    fun date(value: String?): Date? = parse(value)?.let(Date::from)

    /** The calendar day [value] falls on in [zone]; null when [parse] is. */
    fun localDate(value: String?, zone: ZoneId = ZoneId.systemDefault()): LocalDate? =
        parse(value)?.atZone(zone)?.toLocalDate()

    /** `YYYY-MM-DD` in [zone]. A value that is not a timestamp (a plain date) keeps its first ten characters. */
    fun dayText(value: String, zone: ZoneId = ZoneId.systemDefault()): String =
        localDate(value, zone)?.toString() ?: value.take(10)

    /**
     * The first day of an all-day calendar event, else null. The server stores an all-day event's dates as midnight
     * UTC, so a start and end that are both midnight UTC and whole days apart are dates, not moments: converting
     * them to a zone behind UTC would show the day before.
     */
    fun allDayDate(start: String?, end: String?): LocalDate? {
        val from = parse(start)?.atOffset(ZoneOffset.UTC) ?: return null
        val to = parse(end)?.atOffset(ZoneOffset.UTC) ?: return null
        val isAllDay = from.toLocalTime() == LocalTime.MIDNIGHT &&
            to.toLocalTime() == LocalTime.MIDNIGHT &&
            Duration.between(from, to) >= Duration.ofDays(1)
        return if (isAllDay) from.toLocalDate() else null
    }
}
