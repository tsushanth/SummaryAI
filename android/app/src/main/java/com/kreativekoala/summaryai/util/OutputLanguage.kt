package com.kreativekoala.summaryai.util

import androidx.appcompat.app.AppCompatDelegate
import com.kreativekoala.summaryai.data.local.PreferencesManager
import kotlinx.coroutines.flow.first
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The language the server should write AI text in (summary, answers to questions, coaching): sent as `output_language`.
 * The stored preference wins; "auto" or empty falls back to the language the app is shown in, so a person who uses the
 * app in Thai gets Thai summaries without having to find a setting.
 */
object OutputLanguage {
    const val AUTO = "auto"

    /**
     * [preference] is the stored value ("auto", empty, or a language tag); [localeTag] is the app/system language.
     * Returns a BCP-47 tag without extensions, or null when neither is usable (then nothing is sent).
     */
    fun resolve(preference: String?, localeTag: String?): String? {
        val pref = preference?.trim().orEmpty()
        val chosen = if (pref.isEmpty() || pref.equals(AUTO, ignoreCase = true)) localeTag else pref
        return normalize(chosen)
    }

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

    /** The language the app is currently shown in: the per-app choice from the picker, else the device language. */
    fun appLocaleTag(): String {
        try {
            val app = AppCompatDelegate.getApplicationLocales()
            if (!app.isEmpty) app.get(0)?.let { return it.toLanguageTag() }
        } catch (_: Throwable) {
            // Not available (no AppCompat state yet): the default locale already carries the per-app choice on Android 13+.
        }
        return Locale.getDefault().toLanguageTag()
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
        runCatching { OutputLanguage.resolve(preferences.preferredLanguage.first(), OutputLanguage.appLocaleTag()) }.getOrNull()
}
