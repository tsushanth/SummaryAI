package com.kreativekoala.summaryai.data.api

import android.util.Log
import com.kreativekoala.summaryai.data.auth.SessionEvents
import com.kreativekoala.summaryai.data.local.SubscriptionStatus
import com.kreativekoala.summaryai.data.local.TokenStorage
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.user.UserSession
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "AuthInterceptor"

/** Refresh when the access token has less than this left. */
private const val REFRESH_WINDOW_MS = 60_000L

/**
 * Adds the Authorization header and keeps the session alive.
 *
 * The Supabase client's own session is the single source of truth. Its refresh token is single use: every
 * refresh returns a new one and invalidates the old one, so a refresh token read back from our own storage
 * (a mirror that can be stale, or already rotated by the client's own background auto-refresh) must never be
 * replayed. That replay was the 1.7.5 failure ("Invalid Refresh Token: Already Used", then 401 on every call).
 *
 * - Only one refresh runs at a time; a request that finds a newer token than the one it failed with just uses it.
 * - A refresh the server definitively rejects first re-reads the client's session; if that is also unusable the
 *   user is signed out cleanly (tokens cleared, [SessionEvents] fired) instead of looping in 401s.
 * - Network or server trouble during a refresh never signs the user out.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenStore: TokenStorage,
    private val subscriptionStatus: SubscriptionStatus,
    private val supabase: SupabaseClient,
    private val sessionEvents: SessionEvents
) : Interceptor {

    private val refreshLock = Any()

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        val skipAuth = originalRequest.url.encodedPath.contains("/health") ||
                originalRequest.url.encodedPath.contains("/webhooks")
        if (skipAuth) return chain.proceed(originalRequest)

        Log.d(TAG, "Request: ${originalRequest.method} ${originalRequest.url.encodedPath} | User: ${tokenStore.userId}")

        val token = validAccessToken()
        val response = chain.proceed(withAuth(originalRequest, token))
        Log.d(TAG, "Response: ${response.code} for ${originalRequest.url.encodedPath}")

        if (response.code == 401 && token != null) {
            val fresh = recoverFrom401(token)
            if (fresh != null && fresh != token) {
                response.close()
                return chain.proceed(withAuth(originalRequest, fresh))
            }
        }
        return response
    }

    private fun withAuth(request: Request, token: String?): Request {
        val builder = request.newBuilder().header("Accept", "application/json")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (subscriptionStatus.isActive) builder.header("x-subscription-active", "true")
        return builder.build()
    }

    /** The token to send now, refreshed first when it is about to expire. Null when there is no session at all. */
    private fun validAccessToken(): String? {
        val session = currentSession()
        if (session != null) {
            mirror(session)
            if (!expiresSoon(session)) return session.accessToken
            return refreshSingleFlight(session.accessToken)?.accessToken ?: session.accessToken
        }
        // The client has no session. Legacy/demo state only: use whatever token we stored, and do not refresh.
        return tokenStore.accessToken
    }

    /** A 401 came back for [failedToken]: return a token worth retrying with, or null. */
    private fun recoverFrom401(failedToken: String): String? {
        val session = currentSession() ?: return null // demo user or already signed out: nothing to refresh
        return refreshSingleFlight(failedToken)?.accessToken ?: session.accessToken.takeIf { it != failedToken }
    }

    /**
     * Refreshes the client's session unless another thread already did. [failedToken] is the access token the
     * caller was using; if the client now holds a different, still-fresh one the work is already done.
     */
    private fun refreshSingleFlight(failedToken: String): UserSession? = synchronized(refreshLock) {
        val current = currentSession()
        if (current != null && current.accessToken != failedToken && !expiresSoon(current)) {
            mirror(current)
            return current
        }
        if (current == null) return null
        try {
            runBlocking { supabase.auth.refreshCurrentSession() }
            val refreshed = currentSession()
            if (refreshed != null) {
                Log.d(TAG, "Session refreshed for user ${refreshed.user?.id}")
                mirror(refreshed)
            }
            return refreshed
        } catch (e: Exception) {
            Log.w(TAG, "Refresh failed: ${e.message}")
            if (e is RestException && isDefinitive(e)) {
                // The refresh token was rejected. The client may hold a newer session than the one we used
                // (its own auto-refresh, another path): prefer that. Otherwise the session is really gone.
                val reloaded = currentSession()
                if (reloaded != null && reloaded.accessToken != failedToken && !expiresSoon(reloaded)) {
                    mirror(reloaded)
                    return reloaded
                }
                endSession()
                return null
            }
            // Offline, timeout, 5xx: keep the session and let the caller carry on with what it has.
            return null
        }
    }

    private fun isDefinitive(e: RestException): Boolean = e.statusCode in 400..403 || e.statusCode == 422

    /** The refresh token is dead everywhere: clear the client session and our mirror, tell the UI. */
    private fun endSession() {
        Log.w(TAG, "Session is no longer valid; signing out")
        try {
            runBlocking { supabase.auth.clearSession() }
        } catch (e: Exception) {
            Log.w(TAG, "clearSession failed: ${e.message}")
        }
        tokenStore.clearTokens()
        sessionEvents.notifySessionLost()
    }

    /**
     * The client's session. After a process restart the client loads it from storage asynchronously, so wait a
     * moment for that before concluding there is none.
     */
    private fun currentSession(): UserSession? {
        supabase.auth.currentSessionOrNull()?.let { return it }
        runBlocking { withTimeoutOrNull(3_000) { supabase.auth.awaitInitialization() } }
        return supabase.auth.currentSessionOrNull()
    }

    private fun expiresSoon(session: UserSession): Boolean =
        session.expiresAt.toEpochMilliseconds() - System.currentTimeMillis() < REFRESH_WINDOW_MS

    /** Keep the stored copy in step with the client's session (read-only mirror, see class comment). */
    private fun mirror(session: UserSession) {
        if (tokenStore.accessToken == session.accessToken && tokenStore.refreshToken == session.refreshToken) return
        tokenStore.saveTokens(
            accessToken = session.accessToken,
            refreshToken = session.refreshToken,
            expiresAt = session.expiresAt.toEpochMilliseconds(),
            userId = session.user?.id ?: tokenStore.userId
        )
    }
}
