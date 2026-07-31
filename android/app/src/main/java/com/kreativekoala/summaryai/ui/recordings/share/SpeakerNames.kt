package com.kreativekoala.summaryai.ui.recordings.share

/**
 * Replaces "Speaker N" tokens (case-insensitive, with one or more spaces) in
 * the receiver with the matching name from [names]. The map is keyed by the
 * 0-indexed speaker index as a string — same convention the server uses.
 * Unmatched indices are left unchanged.
 */
private val SPEAKER_REGEX = Regex("""\bSpeaker\s+(\d+)\b""", RegexOption.IGNORE_CASE)

fun String.applyingSpeakerNames(names: Map<String, String>?): String {
    if (names.isNullOrEmpty()) return this
    return SPEAKER_REGEX.replace(this) { match ->
        val idx = match.groupValues[1]
        val custom = names[idx]?.trim()
        if (!custom.isNullOrEmpty()) custom else match.value
    }
}
