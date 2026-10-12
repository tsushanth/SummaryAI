package com.kreativekoala.summaryai.ui.recordings.organize

import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** An inclusive range of calendar days in the user's time zone. */
data class DateRangeSelection(val start: LocalDate, val end: LocalDate) {

    /** First instant of [start] in [zone], as the ISO-8601 UTC string the API expects. */
    fun fromIso(zone: ZoneId = ZoneId.systemDefault()): String =
        start.atStartOfDay(zone).toInstant().toString()

    /** Last millisecond of [end] in [zone], as ISO-8601 UTC (the API's `to` is inclusive). */
    fun toIso(zone: ZoneId = ZoneId.systemDefault()): String =
        end.plusDays(1).atStartOfDay(zone).toInstant().minusMillis(1).toString()

    fun label(locale: Locale = Locale.getDefault()): String {
        val f = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)
        return if (start == end) start.format(f) else "${start.format(f)} - ${end.format(f)}"
    }

    companion object {
        /**
         * Material date pickers report a day as UTC midnight millis; convert to that calendar
         * day, not to a local instant (otherwise west-of-UTC users get the previous day).
         */
        fun fromPickerMillis(startMillis: Long?, endMillis: Long?): DateRangeSelection? {
            if (startMillis == null) return null
            val s = Instant.ofEpochMilli(startMillis).atZone(ZoneOffset.UTC).toLocalDate()
            val e = endMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() } ?: s
            return if (e.isBefore(s)) DateRangeSelection(e, s) else DateRangeSelection(s, e)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateRangePickerDialog(
    initial: DateRangeSelection?,
    onDismiss: () -> Unit,
    onConfirm: (DateRangeSelection) -> Unit,
) {
    val state = rememberDateRangePickerState(
        initialSelectedStartDateMillis = initial?.start?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli(),
        initialSelectedEndDateMillis = initial?.end?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli(),
    )
    val picked = DateRangeSelection.fromPickerMillis(state.selectedStartDateMillis, state.selectedEndDateMillis)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { picked?.let(onConfirm) }, enabled = picked != null) { Text("Apply") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) {
        DateRangePicker(state = state)
    }
}
