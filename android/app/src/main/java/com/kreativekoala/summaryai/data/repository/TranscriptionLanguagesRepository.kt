package com.kreativekoala.summaryai.data.repository

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.LanguageCatalog
import com.kreativekoala.summaryai.data.MeetingLanguages
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.DefaultLanguageRequest
import com.kreativekoala.summaryai.data.api.models.TranscriptionLanguagesResponse
import com.kreativekoala.summaryai.data.local.PreferencesManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** Maps the backend body to what the pickers use. Unknown/blank entries are dropped; an empty list is not trusted. */
internal fun TranscriptionLanguagesResponse.toCatalog(): LanguageCatalog? {
    val options = languages.orEmpty()
        .filter { it.code.isNotBlank() }
        .map { MeetingLanguages.Option(MeetingLanguages.normalize(it.code), (it.native ?: it.name ?: it.code)) }
        .filter { it.code != MeetingLanguages.AUTO }
        .distinctBy { it.code }
    if (options.isEmpty()) return null
    return LanguageCatalog(
        languages = options,
        defaultLanguage = MeetingLanguages.normalize(defaultLanguage),
        provider = live?.provider,
        canChangeDuringMeeting = live?.canChangeDuringMeeting,
        englishOnlyLowLatency = live?.englishOnlyLowLatency == true,
        delayMinutes = live?.nonEnglishLiveDelayMinutes,
        fromServer = true,
    )
}

/**
 * The selectable transcription languages (owned by the backend), the user's saved default, and what
 * live captions can do. Cached in memory and, as the raw body, in DataStore; a short built-in list is
 * used only if the call has never succeeded.
 */
@Singleton
class TranscriptionLanguagesRepository @Inject constructor(
    private val api: SummaryAIApi,
    private val preferences: PreferencesManager,
) {
    private val gson = Gson()
    private val _catalog = MutableStateFlow(LanguageCatalog.FALLBACK)
    val catalog: StateFlow<LanguageCatalog> = _catalog.asStateFlow()

    private var fetchedAtMs = 0L

    /** Fetch (at most every [TTL_MS] unless [force]); on failure keep the cache, else the fallback. */
    suspend fun refresh(force: Boolean = false, nowMs: Long = System.currentTimeMillis()): LanguageCatalog =
        withContext(Dispatchers.IO) {
            val current = _catalog.value
            if (!force && current.fromServer && nowMs - fetchedAtMs < TTL_MS) return@withContext current
            try {
                val body = api.getTranscriptionLanguages()
                val fresh = body.toCatalog()
                if (fresh != null) {
                    _catalog.value = fresh
                    fetchedAtMs = nowMs
                    runCatching { preferences.setLanguageCatalogCache(gson.toJson(body)) }
                    return@withContext fresh
                }
            } catch (_: Exception) {
                // fall through to the cache
            }
            if (!_catalog.value.fromServer) {
                val cached = runCatching {
                    gson.fromJson(preferences.languageCatalogCache(), TranscriptionLanguagesResponse::class.java)?.toCatalog()
                }.getOrNull()
                if (cached != null) _catalog.value = cached
            }
            _catalog.value
        }

    /** Saves the default on the backend ('auto' clears it). Best effort: the local copy is the cache. */
    suspend fun saveDefault(language: String): Boolean = withContext(Dispatchers.IO) {
        val value = MeetingLanguages.normalize(language)
        try {
            val ok = api.setDefaultTranscriptionLanguage(DefaultLanguageRequest(value)).isSuccessful
            if (ok) _catalog.value = _catalog.value.copy(defaultLanguage = value)
            ok
        } catch (_: Exception) {
            false
        }
    }

    private companion object {
        const val TTL_MS = 10 * 60 * 1000L
    }
}
