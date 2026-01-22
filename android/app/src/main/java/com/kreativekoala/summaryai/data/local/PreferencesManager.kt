package com.kreativekoala.summaryai.data.local

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * DataStore preferences manager for app settings
 */
@Singleton
class PreferencesManager @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {
    companion object {
        private val KEY_HAS_COMPLETED_ONBOARDING = booleanPreferencesKey("has_completed_onboarding")
        private val KEY_HAS_SKIPPED_SIGN_IN = booleanPreferencesKey("has_skipped_sign_in")
        private val KEY_LAST_SYNC_TIME = stringPreferencesKey("last_sync_time")
        private val KEY_PREFERRED_LANGUAGE = stringPreferencesKey("preferred_language")
        private val KEY_AUTO_JOIN_MEETINGS = booleanPreferencesKey("auto_join_meetings")
        private val KEY_NOTIFICATION_ENABLED = booleanPreferencesKey("notification_enabled")
        private val KEY_DARK_MODE = stringPreferencesKey("dark_mode") // "system", "light", "dark"
    }

    // Onboarding
    val hasCompletedOnboarding: Flow<Boolean> = dataStore.data.map { preferences ->
        preferences[KEY_HAS_COMPLETED_ONBOARDING] ?: false
    }

    suspend fun setOnboardingCompleted(completed: Boolean) {
        dataStore.edit { preferences ->
            preferences[KEY_HAS_COMPLETED_ONBOARDING] = completed
        }
    }

    // Skipped sign-in (guest mode)
    val hasSkippedSignIn: Flow<Boolean> = dataStore.data.map { preferences ->
        preferences[KEY_HAS_SKIPPED_SIGN_IN] ?: false
    }

    suspend fun setSkippedSignIn(skipped: Boolean) {
        dataStore.edit { preferences ->
            preferences[KEY_HAS_SKIPPED_SIGN_IN] = skipped
        }
    }

    // Last sync time
    val lastSyncTime: Flow<String?> = dataStore.data.map { preferences ->
        preferences[KEY_LAST_SYNC_TIME]
    }

    suspend fun setLastSyncTime(time: String) {
        dataStore.edit { preferences ->
            preferences[KEY_LAST_SYNC_TIME] = time
        }
    }

    // Preferred language
    val preferredLanguage: Flow<String> = dataStore.data.map { preferences ->
        preferences[KEY_PREFERRED_LANGUAGE] ?: "auto"
    }

    suspend fun setPreferredLanguage(language: String) {
        dataStore.edit { preferences ->
            preferences[KEY_PREFERRED_LANGUAGE] = language
        }
    }

    // Auto-join meetings
    val autoJoinMeetings: Flow<Boolean> = dataStore.data.map { preferences ->
        preferences[KEY_AUTO_JOIN_MEETINGS] ?: false
    }

    suspend fun setAutoJoinMeetings(enabled: Boolean) {
        dataStore.edit { preferences ->
            preferences[KEY_AUTO_JOIN_MEETINGS] = enabled
        }
    }

    // Notifications
    val notificationsEnabled: Flow<Boolean> = dataStore.data.map { preferences ->
        preferences[KEY_NOTIFICATION_ENABLED] ?: true
    }

    suspend fun setNotificationsEnabled(enabled: Boolean) {
        dataStore.edit { preferences ->
            preferences[KEY_NOTIFICATION_ENABLED] = enabled
        }
    }

    // Dark mode
    val darkMode: Flow<String> = dataStore.data.map { preferences ->
        preferences[KEY_DARK_MODE] ?: "system"
    }

    suspend fun setDarkMode(mode: String) {
        dataStore.edit { preferences ->
            preferences[KEY_DARK_MODE] = mode
        }
    }

    // Clear all preferences
    suspend fun clearAll() {
        dataStore.edit { preferences ->
            preferences.clear()
        }
    }
}
