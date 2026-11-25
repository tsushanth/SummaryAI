package com.kreativekoala.summaryai.util

/** App features that can be switched off while their code stays in the app. */
object FeatureFlags {
    /**
     * Phone calls (the Phone tab and its screen). Off since 1.7.14. To switch them back on: set this to true, restore
     * the two service descriptions in strings.xml, and set FEATURE_PHONE_CALLS on the server.
     */
    const val PHONE_CALLS = false
}
