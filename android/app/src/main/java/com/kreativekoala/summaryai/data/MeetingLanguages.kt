package com.kreativekoala.summaryai.data

/**
 * Per-meeting transcription language helpers.
 *
 * The list of selectable languages is owned by the backend (`GET /api/meetings/transcription-languages`,
 * see [com.kreativekoala.summaryai.data.repository.TranscriptionLanguagesRepository]); this object only
 * normalizes codes and builds request values. [FALLBACK_OPTIONS] is a short list used when that call has
 * never succeeded. Every code in it must be in the backend allow-list (the backend rejects others with 400;
 * for example `ar` is NOT supported).
 */
object MeetingLanguages {
    const val AUTO = "auto"

    data class Option(val code: String, val nativeName: String)

    /** Used only when the backend list could not be fetched. Subset of the backend's 35 codes. */
    val FALLBACK_OPTIONS: List<Option> = listOf(
        Option("en", "English"),
        Option("es", "Español"),
        Option("fr", "Français"),
        Option("de", "Deutsch"),
        Option("pt", "Português"),
        Option("it", "Italiano"),
        Option("nl", "Nederlands"),
        Option("hi", "हिन्दी"),
        Option("ja", "日本語"),
        Option("ko", "한국어"),
        Option("zh", "中文"),
        Option("ru", "Русский"),
        Option("tr", "Türkçe"),
        Option("pl", "Polski"),
        Option("id", "Bahasa Indonesia"),
        Option("th", "ไทย"),
        Option("vi", "Tiếng Việt"),
    )

    // Same aliases the backend accepts (old Java/Android locale codes, Norwegian variants).
    private val ALIASES = mapOf("iw" to "he", "in" to "id", "nb" to "no", "nn" to "no")
    private val SHAPE = Regex("[a-z]{2,3}")

    /** [AUTO] or a lowercase primary subtag. Region subtags are dropped (fr-CA -> fr); junk becomes [AUTO]. */
    fun normalize(raw: String?): String {
        val primary = raw?.trim()?.lowercase()?.substringBefore('-')?.substringBefore('_').orEmpty()
        val code = ALIASES[primary] ?: primary
        return if (code != AUTO && SHAPE.matches(code)) code else AUTO
    }

    fun isAuto(raw: String?): Boolean = normalize(raw) == AUTO

    /**
     * Value for the `transcription_language` field of a meeting request, or null to omit it.
     * A chosen language is always sent. Auto is omitted (so the body is what older builds sent) unless the
     * user's saved default on the backend is a language, in which case omitting would silently apply that
     * default, so "auto" is sent explicitly.
     */
    fun requestValue(choice: String?, serverDefault: String? = null): String? {
        val c = normalize(choice)
        if (c != AUTO) return c
        return if (!isAuto(serverDefault)) AUTO else null
    }
}

/** What the language pickers offer, plus what the live transcript can do (from the backend). */
data class LanguageCatalog(
    val languages: List<MeetingLanguages.Option>,
    /** The user's saved default on the backend ("auto" or a code). */
    val defaultLanguage: String = MeetingLanguages.AUTO,
    val provider: String? = null,
    val canChangeDuringMeeting: Boolean? = null,
    /** Live captions are only low-latency in English on this provider. */
    val englishOnlyLowLatency: Boolean = false,
    /** e.g. "3-10": how late non-English live captions arrive on that provider. */
    val delayMinutes: String? = null,
    /** False = built-in fallback (backend list never fetched). */
    val fromServer: Boolean = false,
) {
    fun nativeName(code: String?): String? {
        val c = MeetingLanguages.normalize(code)
        return languages.firstOrNull { it.code == c }?.nativeName
            ?: MeetingLanguages.FALLBACK_OPTIONS.firstOrNull { it.code == c }?.nativeName
    }

    fun contains(code: String?): Boolean {
        val c = MeetingLanguages.normalize(code)
        return c == MeetingLanguages.AUTO || languages.any { it.code == c }
    }

    /** A non-English choice on a provider whose live captions are only fast in English. */
    fun liveCaptionsDelayed(choice: String?): Boolean {
        val c = MeetingLanguages.normalize(choice)
        return englishOnlyLowLatency && c != MeetingLanguages.AUTO && c != "en"
    }

    companion object {
        val FALLBACK = LanguageCatalog(languages = MeetingLanguages.FALLBACK_OPTIONS)
    }
}
