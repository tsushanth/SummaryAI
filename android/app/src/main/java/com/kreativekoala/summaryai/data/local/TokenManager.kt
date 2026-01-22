package com.kreativekoala.summaryai.data.local

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Secure token storage using EncryptedSharedPreferences
 */
@Singleton
class TokenManager @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val encryptedPrefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "encrypted_prefs",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_TOKEN_EXPIRY = "token_expiry"
        private const val KEY_USER_ID = "user_id"
    }

    var accessToken: String?
        get() = encryptedPrefs.getString(KEY_ACCESS_TOKEN, null)
        set(value) {
            encryptedPrefs.edit().putString(KEY_ACCESS_TOKEN, value).apply()
        }

    var refreshToken: String?
        get() = encryptedPrefs.getString(KEY_REFRESH_TOKEN, null)
        set(value) {
            encryptedPrefs.edit().putString(KEY_REFRESH_TOKEN, value).apply()
        }

    var tokenExpiry: Long
        get() = encryptedPrefs.getLong(KEY_TOKEN_EXPIRY, 0L)
        set(value) {
            encryptedPrefs.edit().putLong(KEY_TOKEN_EXPIRY, value).apply()
        }

    var userId: String?
        get() = encryptedPrefs.getString(KEY_USER_ID, null)
        set(value) {
            encryptedPrefs.edit().putString(KEY_USER_ID, value).apply()
        }

    val isLoggedIn: Boolean
        get() = accessToken != null

    val isTokenExpired: Boolean
        get() = System.currentTimeMillis() > tokenExpiry

    fun saveTokens(accessToken: String, refreshToken: String?, expiresAt: Long, userId: String?) {
        // Use commit() for synchronous write to ensure tokens are persisted
        // before any API calls are made
        encryptedPrefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putLong(KEY_TOKEN_EXPIRY, expiresAt)
            .putString(KEY_USER_ID, userId)
            .commit()
    }

    fun clearTokens() {
        encryptedPrefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_TOKEN_EXPIRY)
            .remove(KEY_USER_ID)
            .apply()
    }
}
