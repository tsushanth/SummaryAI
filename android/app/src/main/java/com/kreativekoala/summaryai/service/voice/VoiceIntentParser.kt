package com.kreativekoala.summaryai.service.voice

/** What the user asked for, read from recognised text by fixed rules. No model is involved, so it works offline. */
sealed interface VoiceIntent {
    /** [dueText] is passed to the server as said ("friday"); the app never turns it into a date itself. */
    data class AddAction(val title: String, val assignee: String?, val dueText: String?) : VoiceIntent
    data object ListOpen : VoiceIntent
    data class MarkDone(val query: String) : VoiceIntent
    data object Debrief : VoiceIntent
    data object Undo : VoiceIntent
    data object Stop : VoiceIntent
    data object Unknown : VoiceIntent
}

/** A reply to a question the assistant just asked (confirm, which one, read aloud?). */
sealed interface VoiceReplyIntent {
    data object Yes : VoiceReplyIntent
    data object No : VoiceReplyIntent
    data object Edit : VoiceReplyIntent
    data object Undo : VoiceReplyIntent
    /** 1-based pick from a list ("the first one", "number two"). */
    data class Pick(val index: Int) : VoiceReplyIntent
    /** "save them", "save all" */
    data object All : VoiceReplyIntent
    /** Several picks: "the first and the third". */
    data class PickMany(val indexes: List<Int>) : VoiceReplyIntent
    /** Anything else; the text is kept so a free-text answer (a date, a title word) can be used. */
    data class Other(val text: String) : VoiceReplyIntent
}

object VoiceIntentParser {

    private val NOUN = "(?:action items?|actions?|tasks?|to-?dos?|reminders?)"
    private val DUE_WORDS = listOf(
        "today", "tonight", "tomorrow", "this week", "next week", "this weekend", "next month", "end of (?:the )?(?:day|week|month)",
        "(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)",
        "in \\d+ (?:days?|weeks?|months?)",
        "\\d{4}-\\d{2}-\\d{2}",
        "\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?",
        "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) \\d{1,2}(?:st|nd|rd|th)?",
        "\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)",
    )
    private val DUE = "(?:${DUE_WORDS.joinToString("|")})"
    // "by friday", "due tomorrow", or the bare word at the very end ("... to send the deck friday").
    private val DUE_TAIL_WITH_PREP = Regex("""\s+(?:by|due|on|before|until|for)\s+($DUE)\s*$""", RegexOption.IGNORE_CASE)
    private val DUE_TAIL_BARE = Regex("""\s+($DUE)\s*$""", RegexOption.IGNORE_CASE)

    private val ADD_PREFIXES = listOf(
        Regex("""^(?:please\s+)?(?:add|create|make|new|log|save)\s+(?:an?\s+|another\s+|a new\s+)?$NOUN\s*(.*)$""", RegexOption.IGNORE_CASE),
        Regex("""^(?:please\s+)?remind me\s+(?:to\s+)?(.*)$""", RegexOption.IGNORE_CASE),
        Regex("""^(?:please\s+)?(?:i need to|i have to|i must|i should)\s+(.*)$""", RegexOption.IGNORE_CASE),
    )
    private val FOR_PERSON_TO = Regex("""^for\s+([\p{L}][\p{L}'.-]*(?:\s+[\p{L}][\p{L}'.-]*)?)\s+to\s+(.+)$""", RegexOption.IGNORE_CASE)
    private val LEAD_FILLER = Regex("""^(?:for me\s+)?(?:(?:to|that|saying|:)\s+)?""", RegexOption.IGNORE_CASE)

    private val LIST_OPEN = listOf(
        Regex("""\b(?:what(?:'s| is| are)?|list|read|show|tell me|give me)\b.*\b(?:my|the)\b.*\b(?:open|pending|outstanding)?\s*$NOUN\b""", RegexOption.IGNORE_CASE),
        Regex("""\bwhat do i (?:have|need to do)\b""", RegexOption.IGNORE_CASE),
        Regex("""\bwhat(?:'s| is) (?:on )?my (?:list|plate)\b""", RegexOption.IGNORE_CASE),
    )
    private val MARK_DONE = listOf(
        Regex("""^(?:please\s+)?mark\s+(?:the\s+)?(.+?)\s+(?:item\s+|task\s+|action\s+|one\s+)?(?:as\s+)?(?:done|complete|completed|finished)$""", RegexOption.IGNORE_CASE),
        Regex("""^(?:please\s+)?(?:complete|finish|check off|tick off|close)\s+(?:the\s+)?(.+?)(?:\s+(?:item|task|action))?$""", RegexOption.IGNORE_CASE),
        Regex("""^i(?:'ve| have)?\s+(?:finished|completed|done)\s+(?:the\s+)?(.+)$""", RegexOption.IGNORE_CASE),
    )
    private val DEBRIEF = Regex("""\b(?:debrief|highlights|how did (?:the|that) meeting go|recap)\b""", RegexOption.IGNORE_CASE)

    fun parse(raw: String): VoiceIntent {
        val text = clean(raw)
        if (text.isEmpty()) return VoiceIntent.Unknown
        val low = text.lowercase()
        if (low in UNDO) return VoiceIntent.Undo
        if (low in STOP) return VoiceIntent.Stop

        for (re in ADD_PREFIXES) {
            val m = re.find(text) ?: continue
            return parseAdd(m.groupValues[1].trim())
        }
        for (re in MARK_DONE) {
            val m = re.find(text) ?: continue
            val q = stripArticles(m.groupValues[1])
            if (q.isNotBlank()) return VoiceIntent.MarkDone(q)
        }
        if (LIST_OPEN.any { it.containsMatchIn(text) }) return VoiceIntent.ListOpen
        if (DEBRIEF.containsMatchIn(text)) return VoiceIntent.Debrief
        return VoiceIntent.Unknown
    }

    private fun parseAdd(rest: String): VoiceIntent {
        var body = rest.replace(LEAD_FILLER, "").trim()
        var assignee: String? = null
        val forPerson = FOR_PERSON_TO.find(rest.trim())
        if (forPerson != null) {
            val who = forPerson.groupValues[1].trim()
            if (!who.equals("me", ignoreCase = true) && !who.equals("myself", ignoreCase = true)) assignee = who
            body = forPerson.groupValues[2].trim()
        }
        var due: String? = null
        val withPrep = DUE_TAIL_WITH_PREP.find(body)
        if (withPrep != null) {
            due = withPrep.groupValues[1].trim()
            body = body.removeRange(withPrep.range).trim()
        } else {
            val bare = DUE_TAIL_BARE.find(body)
            if (bare != null && body.removeRange(bare.range).trim().split(Regex("\\s+")).size >= 2) {
                due = bare.groupValues[1].trim()
                body = body.removeRange(bare.range).trim()
            }
        }
        body = body.trim().trimEnd('.', ',', '!', '?')
        if (body.length < 2) return VoiceIntent.Unknown
        return VoiceIntent.AddAction(title = body.replaceFirstChar { it.uppercase() }, assignee = assignee, dueText = due)
    }

    // ---- replies --------------------------------------------------------------------------------------------------

    private val YES = setOf(
        "yes", "yeah", "yep", "yup", "sure", "ok", "okay", "correct", "right", "confirm", "do it", "go ahead", "save", "save it",
        "yes save it", "yes please", "yes save", "that's right", "thats right", "that is right", "looks good", "sounds good",
    )
    private val NO = setOf("no", "nope", "cancel", "don't", "dont", "stop", "never mind", "nevermind", "discard", "no thanks", "no thank you", "skip", "skip it")
    private val EDIT = setOf("edit", "change", "change it", "edit it", "let me edit", "i'll edit", "fix it", "not quite", "no change it", "no edit")
    private val UNDO = setOf("undo", "undo that", "undo it", "take it back", "revert", "revert that")
    private val STOP = setOf("stop", "cancel", "never mind", "nevermind", "quiet", "be quiet", "that's all", "thats all")
    private val ALL = setOf("all", "all of them", "everything", "save them", "save them all", "save all", "yes all", "both", "both of them", "the lot")
    private val ORDINALS = mapOf(
        "first" to 1, "1st" to 1, "one" to 1, "1" to 1, "number one" to 1, "the first" to 1, "the first one" to 1, "first one" to 1,
        "second" to 2, "2nd" to 2, "two" to 2, "2" to 2, "number two" to 2, "the second" to 2, "the second one" to 2, "second one" to 2,
        "third" to 3, "3rd" to 3, "three" to 3, "3" to 3, "number three" to 3, "the third" to 3, "the third one" to 3, "third one" to 3,
    )

    fun parseReply(raw: String): VoiceReplyIntent {
        val text = clean(raw)
        val low = text.lowercase().replace(Regex("[.!?,]"), "").trim()
        if (low.isEmpty()) return VoiceReplyIntent.Other("")
        // The whole utterance must be a plain yes: "yes but make it monday" is NOT a yes.
        if (low in UNDO) return VoiceReplyIntent.Undo
        if (low in EDIT) return VoiceReplyIntent.Edit
        if (low in YES) return VoiceReplyIntent.Yes
        if (low in NO) return VoiceReplyIntent.No
        if (low in ALL) return VoiceReplyIntent.All
        ORDINALS[low]?.let { return VoiceReplyIntent.Pick(it) }
        // "the first and the third", "first and second"
        if (low.contains(" and ")) {
            val parts = low.split(" and ").map { it.trim() }
            val picks = parts.mapNotNull { ORDINALS[it] }
            if (picks.size == parts.size && picks.isNotEmpty()) return VoiceReplyIntent.PickMany(picks.distinct())
        }
        // "save the first one only", "just the second"
        val only = Regex("""^(?:save |just |only )?(?:the )?(first|second|third|1st|2nd|3rd)(?: one)?(?: only)?$""").find(low)
        if (only != null) ORDINALS[only.groupValues[1]]?.let { return VoiceReplyIntent.Pick(it) }
        if (low.startsWith("no ") || low.startsWith("cancel")) return VoiceReplyIntent.No
        return VoiceReplyIntent.Other(text)
    }

    // ---- helpers --------------------------------------------------------------------------------------------------

    internal fun clean(raw: String): String = raw.trim().replace(Regex("\\s+"), " ").trim('"', '“', '”')

    private fun stripArticles(s: String): String =
        s.trim().replace(Regex("^(?:the|my|that|this)\\s+", RegexOption.IGNORE_CASE), "").replace(Regex("\\s+(?:item|task|action)$", RegexOption.IGNORE_CASE), "").trim()
}
