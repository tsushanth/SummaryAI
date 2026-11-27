package com.kreativekoala.summaryai.service

import android.content.Context
import android.content.SharedPreferences
import com.kreativekoala.summaryai.data.repository.PhoneRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Whether the signed-in account has phone calls, as the server says. The Phone tab exists only when it does. The last
 * answer is kept per account so the tab does not jump in and out at start-up; a failed check keeps it.
 */
class PhoneAvailabilityState(private val prefs: SharedPreferences) {
    private val _enabled = MutableStateFlow(false)
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()
    private var account: String? = null

    /** Shows what was last known for [userId]; null (signed out) shows nothing. */
    fun switchTo(userId: String?) {
        account = userId
        _enabled.value = userId != null && prefs.getString(KEY, null) == userId
    }

    /** The server's answer for [userId]. Ignored when the account changed while it was on its way. */
    fun apply(userId: String, enabled: Boolean) {
        if (account != userId) return
        _enabled.value = enabled
        prefs.edit().apply { if (enabled) putString(KEY, userId) else remove(KEY) }.apply()
    }

    private companion object { const val KEY = "enabled_for" }
}

@Singleton
class PhoneAvailability @Inject constructor(
    @ApplicationContext context: Context,
    private val repository: PhoneRepository,
    private val voip: VoipService
) {
    private val state = PhoneAvailabilityState(context.getSharedPreferences("phone_availability", Context.MODE_PRIVATE))
    val enabled: StateFlow<Boolean> get() = state.enabled

    suspend fun refresh(userId: String?) {
        state.switchTo(userId)
        if (userId == null) {
            voip.disconnect() // signing out ends a call in progress
            return
        }
        repository.status().onSuccess { state.apply(userId, it.enabled) }
    }
}
