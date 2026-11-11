package com.kreativekoala.summaryai.data.local

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.kreativekoala.summaryai.FailureReporter
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Token storage on the app's encrypted store ([SecurePrefs]). Storage failures (e.g. a lost Keystore key) read as
 * "signed out" and drop writes; they never throw. Tokens are never logged.
 */
@Singleton
class TokenManager(private val prefs: SharedPreferences) : TokenStorage {

    @Inject
    constructor(@ApplicationContext context: Context) : this(SecurePrefs.get(context))

    companion object {
        private const val TAG = "TokenManager"
        internal const val KEY_ACCESS_TOKEN = "access_token"
        internal const val KEY_REFRESH_TOKEN = "refresh_token"
        internal const val KEY_TOKEN_EXPIRY = "token_expiry"
        internal const val KEY_USER_ID = "user_id"
    }

    init {
        // A report sent before the user signs in again (e.g. a startup crash) should still say who it affected.
        FailureReporter.setUser(readString(KEY_USER_ID))
    }

    private fun readString(key: String): String? = try {
        prefs.getString(key, null)
    } catch (e: Exception) {
        Log.w(TAG, "Token store unreadable (${e.javaClass.simpleName})")
        null
    }

    private fun readLong(key: String): Long = try {
        prefs.getLong(key, 0L)
    } catch (e: Exception) {
        Log.w(TAG, "Token store unreadable (${e.javaClass.simpleName})")
        0L
    }

    private fun write(block: SharedPreferences.Editor.() -> Unit) {
        try {
            prefs.edit().apply(block).apply()
        } catch (e: Exception) {
            Log.w(TAG, "Token store not writable (${e.javaClass.simpleName})")
        }
    }

    override var accessToken: String?
        get() = readString(KEY_ACCESS_TOKEN)
        set(value) = write { putString(KEY_ACCESS_TOKEN, value) }

    override var refreshToken: String?
        get() = readString(KEY_REFRESH_TOKEN)
        set(value) = write { putString(KEY_REFRESH_TOKEN, value) }

    override var tokenExpiry: Long
        get() = readLong(KEY_TOKEN_EXPIRY)
        set(value) = write { putLong(KEY_TOKEN_EXPIRY, value) }

    override var userId: String?
        get() = readString(KEY_USER_ID)
        set(value) {
            write { putString(KEY_USER_ID, value) }
            FailureReporter.setUser(value)
        }

    override val isLoggedIn: Boolean
        get() = accessToken != null

    override val isTokenExpired: Boolean
        get() = System.currentTimeMillis() > tokenExpiry

    override fun saveTokens(accessToken: String, refreshToken: String?, expiresAt: Long, userId: String?) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken
        this.tokenExpiry = expiresAt
        this.userId = userId
    }

    override fun clearTokens() {
        write {
            remove(KEY_ACCESS_TOKEN)
            remove(KEY_REFRESH_TOKEN)
            remove(KEY_TOKEN_EXPIRY)
            remove(KEY_USER_ID)
        }
        FailureReporter.setUser(null)
    }
}
