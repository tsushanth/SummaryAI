package com.kreativekoala.summaryai.ui.onboarding

import android.content.SharedPreferences
import com.kreativekoala.summaryai.ui.navigation.Screen
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * First-run routing. A new signed-in user goes straight to the Record tab (no slides, no email screen); the email
 * screen is only used when the account has no email at all. Returning users go to the list.
 */
object FirstRunRouting {
    fun emailMissing(email: String?): Boolean = email.isNullOrBlank()

    fun isFirstRun(isAuthenticated: Boolean, hasCompletedOnboarding: Boolean): Boolean =
        isAuthenticated && !hasCompletedOnboarding

    fun target(isAuthenticated: Boolean, hasCompletedOnboarding: Boolean, emailMissing: Boolean): String = when {
        !isAuthenticated -> Screen.Auth.route
        !hasCompletedOnboarding && emailMissing -> Screen.Onboarding.route
        !hasCompletedOnboarding -> Screen.Recording.route
        else -> Screen.Recordings.route
    }
}

/**
 * True from the moment a brand-new user lands on Record until their first recording starts; the Record screen
 * shows its one-line prompt (and the sample link) while it is active. Never restarts once finished.
 */
class FirstRunState(private val prefs: SharedPreferences) {
    private val _activeFlow = MutableStateFlow(prefs.getBoolean(K_ACTIVE, false))

    /** Observable so a Record screen that is already composed picks the change up whenever [begin] lands. */
    val activeFlow: StateFlow<Boolean> = _activeFlow.asStateFlow()
    val active: Boolean get() = _activeFlow.value

    fun begin() {
        if (prefs.getBoolean(K_FINISHED, false)) return
        prefs.edit().putBoolean(K_ACTIVE, true).apply()
        _activeFlow.value = true
    }

    fun finish() {
        prefs.edit().putBoolean(K_ACTIVE, false).putBoolean(K_FINISHED, true).apply()
        _activeFlow.value = false
    }

    companion object {
        const val PREFS_NAME = "mm_first_run"
        private const val K_ACTIVE = "active"
        private const val K_FINISHED = "finished"
    }
}
