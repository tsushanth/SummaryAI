package com.kreativekoala.summaryai.util

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A language set before the first launch must not be wiped by AppCompat's one-time locale sync (Android 13+). */
class AppLocaleSyncTest {
    @Test fun skipsTheSyncWhenTheSystemAlreadyHoldsALanguageOnFirstRun() {
        assertTrue(shouldSkipAppCompatLocaleSync(markerAlreadyEnabled = false, frameworkHasLocales = true))
    }

    @Test fun letsAppCompatMigrateAStoredLanguageWhenTheSystemHasNone() {
        assertFalse(shouldSkipAppCompatLocaleSync(markerAlreadyEnabled = false, frameworkHasLocales = false))
    }

    @Test fun doesNothingOnceTheSyncHasAlreadyRun() {
        assertFalse(shouldSkipAppCompatLocaleSync(markerAlreadyEnabled = true, frameworkHasLocales = true))
        assertFalse(shouldSkipAppCompatLocaleSync(markerAlreadyEnabled = true, frameworkHasLocales = false))
    }
}
