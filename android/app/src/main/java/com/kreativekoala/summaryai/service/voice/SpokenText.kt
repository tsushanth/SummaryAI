package com.kreativekoala.summaryai.service.voice

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** Turns data into short sentences that read well aloud. Pure functions so they are easy to test. */
object SpokenText {

    private const val MAX_READ = 3

    /** "today", "tomorrow", "Friday" (within the next week), otherwise "Friday, November 6". Past dates say how late. */
    fun day(iso: String?, today: LocalDate): String? {
        val d = parse(iso) ?: return null
        val days = java.time.temporal.ChronoUnit.DAYS.between(today, d)
        return when {
            days == 0L -> "today"
            days == 1L -> "tomorrow"
            days in 2..6 -> d.dayOfWeek.spoken()
            else -> "${d.dayOfWeek.spoken()}, ${d.month.getDisplayName(TextStyle.FULL, Locale.ENGLISH)} ${d.dayOfMonth}"
        }
    }

    /** The sentence read back before an action is saved. Mirrors the fields the server will save. */
    fun readback(draft: ActionDraft, today: LocalDate): String {
        val parts = mutableListOf("Task: ${draft.title.trimEnd('.')}.")
        draft.assignee?.takeIf { it.isNotBlank() }?.let { parts += "Owner: $it." }
        day(draft.dueDate, today)?.let { parts += "Due $it." }
        return parts.joinToString(" ") + " Save it?"
    }

    /** "You have five. Overdue: x, due Monday. Due Friday: y. Then two with no date." Reads at most three titles. */
    fun openActions(actions: List<VoiceAction>, today: LocalDate): String {
        if (actions.isEmpty()) return "You have no open actions."
        val dated = actions.filter { parse(it.dueDate) != null }
        val undated = actions.size - dated.size
        val sb = StringBuilder()
        sb.append("You have ").append(count(actions.size)).append(if (actions.size == 1) " open action." else " open actions.")
        val read = dated.take(MAX_READ)
        for (a in read) {
            val d = parse(a.dueDate)!!
            val label = if (d.isBefore(today)) "Overdue" else "Due ${day(a.dueDate, today)}"
            sb.append(' ').append(label).append(": ").append(a.title.trimEnd('.')).append('.')
        }
        val unreadDated = dated.size - read.size
        if (read.isEmpty() && undated > 0) {
            // Nothing dated: read the first few undated titles instead of only a count.
            val firsts = actions.take(MAX_READ).joinToString("; ") { it.title.trimEnd('.') }
            sb.append(' ').append(firsts).append('.')
            val rest = actions.size - minOf(actions.size, MAX_READ)
            if (rest > 0) sb.append(" Want the rest?")
            return sb.toString()
        }
        if (undated > 0) sb.append(' ').append(count(undated).replaceFirstChar { it.uppercase() }).append(" with no date.")
        if (unreadDated > 0) sb.append(" Want the rest?")
        return sb.toString()
    }

    /** Short spoken debrief: up to three decisions and three actions, then the offer to save. */
    fun debrief(d: Debrief, today: LocalDate): String {
        if (d.decisions.isEmpty() && d.actions.isEmpty()) {
            return d.note ?: "I did not find clear decisions or actions in that meeting."
        }
        val sb = StringBuilder()
        if (d.decisions.isNotEmpty()) {
            sb.append(count(d.decisions.size).replaceFirstChar { it.uppercase() })
                .append(if (d.decisions.size == 1) " decision: " else " decisions: ")
                .append(d.decisions.take(MAX_READ).joinToString("; ") { it.text.trimEnd('.') })
                .append('.')
            if (d.decisions.size > MAX_READ) sb.append(" And ").append(d.decisions.size - MAX_READ).append(" more.")
        }
        if (d.actions.isNotEmpty()) {
            if (sb.isNotEmpty()) sb.append(' ')
            sb.append(count(d.actions.size).replaceFirstChar { it.uppercase() })
                .append(if (d.actions.size == 1) " action: " else " actions: ")
                .append(
                    d.actions.take(MAX_READ).joinToString("; ") { a ->
                        val due = day(a.dueDate, today)
                        a.text.trimEnd('.') + (a.owner?.takeIf { it.isNotBlank() }?.let { ", for $it" } ?: "") + (due?.let { ", due $it" } ?: "")
                    }
                )
                .append('.')
            if (d.actions.size > MAX_READ) sb.append(" And ").append(d.actions.size - MAX_READ).append(" more.")
            sb.append(" Say save them to add them to your list.")
        }
        if (d.truncated) sb.append(" That meeting was long, so I only covered the first part.")
        return sb.toString()
    }

    fun parse(iso: String?): LocalDate? = try {
        if (iso.isNullOrBlank() || iso.length < 10) null else LocalDate.parse(iso.substring(0, 10))
    } catch (_: Exception) {
        null
    }

    private fun DayOfWeek.spoken(): String = getDisplayName(TextStyle.FULL, Locale.ENGLISH)

    private fun count(n: Int): String = when (n) {
        0 -> "zero"; 1 -> "one"; 2 -> "two"; 3 -> "three"; 4 -> "four"; 5 -> "five"; 6 -> "six"; 7 -> "seven"; 8 -> "eight"; 9 -> "nine"
        else -> n.toString()
    }
}
