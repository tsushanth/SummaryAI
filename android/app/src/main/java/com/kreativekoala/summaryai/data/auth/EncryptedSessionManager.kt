package com.kreativekoala.summaryai.data.auth

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.kreativekoala.summaryai.BuildConfig
import com.kreativekoala.summaryai.data.local.SecurePrefs
import io.github.jan.supabase.gotrue.SessionManager
import io.github.jan.supabase.gotrue.user.UserSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/**
 * Persists the Supabase session (access token, refresh token, user profile incl. email) in the encrypted store.
 *
 * supabase-kt's default session manager writes the session as clear JSON in the app's DEFAULT SharedPreferences
 * file (`<applicationId>_preferences.xml`), which Auto Backup used to copy off the device. This replaces it.
 * The library keys that entry `sb-<supabase url without scheme, '.' and '/' as '-'>-session` (see [libraryKeyFor]);
 * very old installs may still hold it under the plain key "session", which the library renames on first load.
 * On the first load after an upgrade the old clear-text session is read from either key, written encrypted and
 * BOTH keys are removed, so users stay signed in and no clear-text copy remains.
 * Any failure ends as "no session" (signed out), never as a crash.
 * Tokens are never logged; only exception class names are.
 */
class EncryptedSessionManager(
    private val secure: SharedPreferences,
    private val legacy: SharedPreferences,
    private val libraryKey: String = libraryKeyFor(BuildConfig.SUPABASE_URL),
    private val json: Json = Json { encodeDefaults = true; ignoreUnknownKeys = true },
) : SessionManager {

    companion object {
        const val SECURE_KEY = "supabase_session"
        /** supabase-kt's SettingsSessionManager.SETTINGS_KEY: what very old installs may still hold. */
        const val LEGACY_KEY = "session"

        /**
         * The key supabase-kt's default session manager actually stores the session under: the same as its
         * `createDefaultSettingsKey(url) + "-session"`, computed here because the library does not expose it.
         * The client strips the scheme from the url before using it.
         */
        fun libraryKeyFor(supabaseUrl: String): String =
            "sb-" + supabaseUrl.removePrefix("https://").removePrefix("http://")
                .removeSuffix("/").replace('/', '-').replace('.', '-') + "-session"
        private const val TAG = "SessionManager"

        fun create(context: Context): EncryptedSessionManager {
            val app = context.applicationContext
            return EncryptedSessionManager(
                secure = SecurePrefs.get(app),
                legacy = app.getSharedPreferences(app.packageName + "_preferences", Context.MODE_PRIVATE),
            )
        }
    }

    /** Every key the clear-text session may sit under, library key first. */
    private val legacyKeys: List<String> = listOf(libraryKey, LEGACY_KEY).distinct()

    override suspend fun saveSession(session: UserSession) {
        withContext(Dispatchers.IO) {
            try {
                val saved = secure.edit().putString(SECURE_KEY, json.encodeToString(UserSession.serializer(), session)).commit()
                if (saved) wipeLegacy() else Log.w(TAG, "Session not saved")
            } catch (e: Exception) {
                Log.w(TAG, "Session not saved (${e.javaClass.simpleName})")
            }
        }
    }

    override suspend fun loadSession(): UserSession? = withContext(Dispatchers.IO) {
        val stored = readString(secure, SECURE_KEY)
        if (stored != null) {
            wipeLegacy() // a leftover clear-text copy never outlives the encrypted one
            return@withContext decode(stored) ?: run { deleteSecure(); null }
        }
        val olds = legacyKeys.mapNotNull { readString(legacy, it) }
        if (olds.isEmpty()) return@withContext null
        val session = olds.firstNotNullOfOrNull { decode(it) }
        if (session == null) {
            wipeLegacy() // unreadable clear-text session: drop it, user signs in again
            return@withContext null
        }
        try {
            // Re-encode rather than copy the raw string so what lands on disk is exactly our format.
            val saved = secure.edit().putString(SECURE_KEY, json.encodeToString(UserSession.serializer(), session)).commit()
            if (saved) wipeLegacy()
            else Log.w(TAG, "Could not encrypt the existing session yet; will retry next launch")
        } catch (e: Exception) {
            // Keep the old copy so the next launch can retry; the user stays signed in for this run.
            Log.w(TAG, "Could not encrypt the existing session yet (${e.javaClass.simpleName})")
        }
        session
    }

    override suspend fun deleteSession() {
        withContext(Dispatchers.IO) {
            deleteSecure()
            wipeLegacy()
        }
    }

    private fun decode(raw: String): UserSession? = try {
        json.decodeFromString(UserSession.serializer(), raw)
    } catch (e: Exception) {
        Log.w(TAG, "Stored session unreadable (${e.javaClass.simpleName})")
        null
    }

    private fun readString(prefs: SharedPreferences, key: String): String? = try {
        prefs.getString(key, null)
    } catch (e: Exception) {
        Log.w(TAG, "Session store unreadable (${e.javaClass.simpleName})")
        null
    }

    private fun deleteSecure() {
        try { secure.edit().remove(SECURE_KEY).commit() } catch (e: Exception) {
            Log.w(TAG, "Session not deleted (${e.javaClass.simpleName})")
        }
    }

    private fun wipeLegacy() {
        try {
            if (legacyKeys.any { legacy.contains(it) }) {
                legacy.edit().apply { legacyKeys.forEach { remove(it) } }.commit()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Old session copy not removed (${e.javaClass.simpleName})")
        }
    }
}
