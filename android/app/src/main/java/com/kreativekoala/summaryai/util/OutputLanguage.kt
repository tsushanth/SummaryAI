package com.kreativekoala.summaryai.util

import com.kreativekoala.summaryai.data.local.PreferencesManager
import kotlinx.coroutines.flow.first
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The language the server should write AI text in (summary, answers to questions, coaching): sent as `output_language`.
 * Only an EXPLICIT preference is sent. "auto" or empty sends nothing, so the server keeps following the transcript's own
 * language as it did before this field existed; the app's display language is deliberately not used as a fallback, because
 * a person using the app in English who records a Spanish meeting expects Spanish notes.
 */
object OutputLanguage {
    const val AUTO = "auto"

    /**
     * [preference] is the stored value ("auto", empty, or a language tag). Returns a BCP-47 tag without extensions for an
     * explicit choice, or null for "auto"/empty/unusable (then nothing is sent).
     */
    fun resolve(preference: String?): String? = normalize(preference)

    /** Language (+ script, region) of a tag; legacy Java codes mapped to the current ones. null for blank or undetermined. */
    fun normalize(tag: String?): String? {
        val raw = tag?.trim().orEmpty()
        if (raw.isEmpty() || raw.equals(AUTO, ignoreCase = true)) return null
        val locale = Locale.forLanguageTag(raw.replace('_', '-'))
        val language = when (val l = locale.language) {
            "in" -> "id"
            "iw" -> "he"
            "ji" -> "yi"
            else -> l
        }
        if (language.isEmpty() || language == "und") return null
        return Locale.Builder().setLanguage(language).setScript(locale.script).setRegion(locale.country).build().toLanguageTag()
    }
}

/** Where repositories get the output language from; a fake in tests. */
fun interface OutputLanguageSource {
    suspend fun current(): String?
}

@Singleton
class PreferenceOutputLanguage @Inject constructor(
    private val preferences: PreferencesManager
) : OutputLanguageSource {
    override suspend fun current(): String? =
        runCatching { OutputLanguage.resolve(preferences.preferredLanguage.first()) }.getOrNull()
}
