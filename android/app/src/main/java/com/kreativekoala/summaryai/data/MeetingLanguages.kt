package com.kreativekoala.summaryai.data

/**
 * Languages a meeting can be transcribed in (live and final).
 *
 * The backend takes `transcription_language` as either "auto" or a BCP-47 primary subtag from its
 * own allow-list. This list is the client's mirror of that allow-list; if the backend list changes,
 * change [options] only. Names are shown in each language's own script so a user can find theirs
 * even when the app is in another language.
 */
object MeetingLanguages {
    const val AUTO = "auto"

    data class Option(val code: String, val nativeName: String)

    val options: List<Option> = listOf(
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
        Option("ar", "العربية"),
    )

    private val codes: Set<String> = options.map { it.code }.toSet()

    /** Maps anything stored or received to either [AUTO] or a code on the list. */
    fun normalize(raw: String?): String {
        val primary = raw?.trim()?.lowercase()?.substringBefore('-')?.substringBefore('_').orEmpty()
        return if (primary in codes) primary else AUTO
    }

    fun isAuto(raw: String?): Boolean = normalize(raw) == AUTO

    /**
     * The value to put in a request body: null for Auto-detect (so the field is omitted and an older
     * backend behaves exactly as before), otherwise the primary subtag.
     */
    fun toRequestValue(raw: String?): String? = normalize(raw).takeIf { it != AUTO }

    /** Native name for a code, or null for Auto-detect / unknown (caller shows the localized "Auto-detect"). */
    fun nativeName(raw: String?): String? = options.firstOrNull { it.code == normalize(raw) }?.nativeName
}
