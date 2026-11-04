package com.kreativekoala.summaryai.data.auth

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Lets the HTTP layer tell the auth layer that the session is definitively gone (the refresh token was
 * rejected and the Supabase client has no valid session either), so the UI can return to sign-in
 * instead of every request failing with 401.
 */
@Singleton
class SessionEvents @Inject constructor() {
    private val _sessionLost = MutableSharedFlow<Unit>(extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val sessionLost: SharedFlow<Unit> = _sessionLost.asSharedFlow()

    fun notifySessionLost() {
        _sessionLost.tryEmit(Unit)
    }
}
