package com.kreativekoala.summaryai.service.voice

import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceConsentStoreTest {
    @Test fun noConsentUntilAcceptedThenRemembered() {
        val prefs = FakeSharedPreferences()
        val store = VoiceConsentStore(prefs)
        assertFalse(store.hasConsent())
        store.accept()
        assertTrue(VoiceConsentStore(prefs).hasConsent())
        store.withdraw()
        assertFalse(store.hasConsent())
    }

    @Test fun anOlderVersionIsAskedAgain() {
        val prefs = FakeSharedPreferences()
        prefs.edit().putInt(VoiceConsentStore.KEY, VoiceConsentStore.VERSION - 1).apply()
        assertFalse(VoiceConsentStore(prefs).hasConsent())
    }
}
