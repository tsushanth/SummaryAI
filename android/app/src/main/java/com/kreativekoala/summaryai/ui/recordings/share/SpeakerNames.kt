package com.kreativekoala.summaryai.ui.recordings.share

import com.kreativekoala.summaryai.domain.model.TranscriptSegment

/*
 * Speaker numbering. The server stores speakers counted from 0: a segment's `speaker_index`, its generated label
 * "Speaker <index>", the keys of `speaker_names`, and the "Speaker N" mentions in summaries. People read numbers from
 * 1, so everything shown or exported goes through here. Same rules as web lib/exportFormats.ts and backend
 * lib/speakers.ts.
 */

/** "Speakers 0 and 1" (a list), or one "Speaker 0", optionally as the "Part 2 speaker 0" of a recording transcribed in parts. */
private val MENTION = Regex(
    """\bSpeakers\s+\d+(?:(?:\s*,\s*(?:and\s+|&\s*)?|\s+and\s+|\s*&\s*)\d+\b)+|\b(?:Part\s+\d+\s+)?Speaker\s+\d+\b""",
    RegexOption.IGNORE_CASE
)
private val GENERATED_LABEL = Regex("""^Speaker (\d+)$""")
private val PART_LABEL = Regex("""^Part (\d+) speaker (\d+)$""")
private val NUMBER = Regex("""\d+""")
private val LAST_NUMBER = Regex("""\d+$""")
private val PLURAL_LEAD = Regex("""^Speakers\s+""", RegexOption.IGNORE_CASE)

private fun Map<String, String>?.nameFor(index: String): String? = this?.get(index)?.trim()?.takeIf { it.isNotEmpty() }

/** The number people read for the stored index [index]. */
fun speakerNumber(index: String): String = index.toLongOrNull()?.let { (it + 1).toString() } ?: index

/**
 * Stored summary text as a person should read it: "Speaker N" means speaker index N, shown as the name in [names] for
 * them, else as "Speaker N+1". Not for the words of a transcript, which are shown as spoken.
 */
fun String.applyingSpeakerNames(names: Map<String, String>?): String {
    var out = MENTION.replace(this) { match ->
        val mention = match.value
        when {
            mention.startsWith("Part", ignoreCase = true) -> LAST_NUMBER.replace(mention) { speakerNumber(it.value) }
            mention.startsWith("Speakers", ignoreCase = true) ->
                if (NUMBER.findAll(mention).none { names.nameFor(it.value) != null }) {
                    NUMBER.replace(mention) { speakerNumber(it.value) }
                } else {
                    NUMBER.replace(PLURAL_LEAD.replace(mention, "")) {
                        names.nameFor(it.value) ?: "Speaker ${speakerNumber(it.value)}"
                    }
                }
            else -> LAST_NUMBER.find(mention)?.value?.let { names.nameFor(it) }
                ?: LAST_NUMBER.replace(mention) { speakerNumber(it.value) }
        }
    }
    // The model often writes the name it heard next to the label ("Speaker 1 (Alex)"), which would now read
    // "Alex (Alex)". Collapse a name that repeats itself in parentheses.
    for (raw in names?.values.orEmpty()) {
        val n = raw.trim()
        if (n.isNotEmpty()) out = out.replace("$n ($n)", n)
    }
    return out
}

/**
 * What to call the speaker of a segment: the name in [names] for them, else a generated label counted from 1, else the
 * stored label as it is (a meeting participant's name, "Document"). Null when the segment says nothing about a speaker.
 */
fun speakerDisplayLabel(label: String?, index: Int?, names: Map<String, String>?): String? {
    index?.let { names.nameFor(it.toString()) }?.let { return it }
    if (label.isNullOrBlank()) return index?.let { "Speaker ${it + 1}" }
    GENERATED_LABEL.matchEntire(label)?.let { match ->
        val n = match.groupValues[1].toIntOrNull() ?: return label
        // A number that is not the index (a bot participant id, or a label already counted from 1) stays.
        return if (index == null || n == index) "Speaker ${n + 1}" else label
    }
    PART_LABEL.matchEntire(label)?.let { match ->
        return "Part ${match.groupValues[1]} speaker ${speakerNumber(match.groupValues[2])}"
    }
    return label
}

/** The `speaker_names` key a segment's speaker is renamed under. */
fun speakerKey(segment: TranscriptSegment): String? =
    segment.speakerIndex?.toString() ?: segment.speaker?.let { NUMBER.find(it)?.value }

/** The participant name the transcript shows for [key] before any rename, or null when the label is a generated one. */
fun participantName(segments: List<TranscriptSegment>, key: String): String? =
    segments.firstOrNull { speakerKey(it) == key }?.speaker
        ?.takeIf { it.isNotBlank() && !GENERATED_LABEL.matches(it) && !PART_LABEL.matches(it) }
