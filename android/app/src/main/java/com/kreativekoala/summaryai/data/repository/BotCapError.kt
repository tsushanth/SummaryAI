package com.kreativekoala.summaryai.data.repository

import com.google.gson.JsonParser
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Error code the backend returns (HTTP 403) when the monthly meeting-bot allowance is used up. */
const val BOT_MONTHLY_CAP_REACHED = "BOT_MONTHLY_CAP_REACHED"

/**
 * The monthly meeting-bot allowance is used up. [resetsAt] is the ISO timestamp the allowance resets at (start of the
 * next UTC month), or null when the response did not carry one.
 */
class BotCapReachedException(val resetsAt: String?) : Exception(BOT_MONTHLY_CAP_REACHED)

/**
 * Pure parsing of a failed join response so it can be unit tested without a network. Returns null for anything that
 * is not the monthly-cap error, so every other failure keeps its existing handling.
 */
internal fun parseBotCapError(httpCode: Int, body: String?): BotCapReachedException? {
    if (httpCode != 403 || body.isNullOrBlank()) return null
    val error = runCatching { JsonParser.parseString(body).asJsonObject.getAsJsonObject("error") }.getOrNull() ?: return null
    val code = runCatching { error.get("code").asString }.getOrNull()
    if (code != BOT_MONTHLY_CAP_REACHED) return null
    val resetsAt = runCatching { error.getAsJsonObject("details").get("resets_at").asString }.getOrNull()
    return BotCapReachedException(resetsAt?.takeIf { it.isNotBlank() })
}

/**
 * The reset date for display in the user's locale. The allowance resets at the start of a UTC month, so the date is
 * rendered in UTC: in time zones behind UTC a local rendering would show the day before the reset.
 * Null when [resetsAt] is missing or not an ISO instant.
 */
internal fun formatBotCapResetDate(resetsAt: String?, locale: Locale): String? {
    if (resetsAt.isNullOrBlank()) return null
    val instant = runCatching { Instant.parse(resetsAt) }.getOrNull() ?: return null
    return DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(locale).withZone(ZoneOffset.UTC).format(instant)
}

/** Picks the message with the date when one can be shown, else the one without. */
internal fun buildBotCapMessage(
    resetsAt: String?,
    locale: Locale,
    withDate: (String) -> String,
    withoutDate: () -> String
): String = formatBotCapResetDate(resetsAt, locale)?.let(withDate) ?: withoutDate()
