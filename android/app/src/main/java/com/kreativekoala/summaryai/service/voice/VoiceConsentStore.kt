package com.kreativekoala.summaryai.service.voice

import android.content.SharedPreferences

/**
 * Remembers that the user accepted the one-time explanation of how speech is recognised. Re-asked if [VERSION] changes.
 * Stored on the device only.
 */
class VoiceConsentStore(private val prefs: SharedPreferences) {
    fun hasConsent(): Boolean = prefs.getInt(KEY, 0) >= VERSION
    fun accept() { prefs.edit().putInt(KEY, VERSION).apply() }
    fun withdraw() { prefs.edit().remove(KEY).apply() }

    companion object {
        const val PREFS_NAME = "voice_actions_prefs"
        const val KEY = "consent_version"
        const val VERSION = 1
    }
}
