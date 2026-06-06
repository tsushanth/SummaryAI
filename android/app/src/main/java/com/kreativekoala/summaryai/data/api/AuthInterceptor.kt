package com.kreativekoala.summaryai.data.api

import android.util.Log
import com.kreativekoala.summaryai.BuildConfig
import com.kreativekoala.summaryai.data.local.SubscriptionStatus
import com.kreativekoala.summaryai.data.local.TokenManager
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.auth
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "AuthInterceptor"

/**
 * OkHttp interceptor that adds Authorization header to requests
 * Automatically refreshes expired tokens using Supabase
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager,
    private val subscriptionStatus: SubscriptionStatus
) : Interceptor {

    // Supabase client for token refresh
    private val supabase: SupabaseClient by lazy {
        createSupabaseClient(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            supabaseKey = BuildConfig.SUPABASE_ANON_KEY
        ) {
            install(Auth)
        }
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Skip auth for certain endpoints
        val skipAuth = originalRequest.url.encodedPath.contains("/health") ||
                originalRequest.url.encodedPath.contains("/webhooks")

        if (skipAuth) {
            return chain.proceed(originalRequest)
        }

        // Log request info for debugging
        val userId = tokenManager.userId
        Log.d(TAG, "Request: ${originalRequest.method} ${originalRequest.url.encodedPath} | User: $userId")

        // Get current token, refreshing if needed
        val token = getValidToken()

        val builder = originalRequest.newBuilder().header("Accept", "application/json")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (subscriptionStatus.isActive) builder.header("x-subscription-active", "true")
        val request = builder.build()

        val response = chain.proceed(request)

        // Log response status
        Log.d(TAG, "Response: ${response.code} for ${originalRequest.url.encodedPath}")

        // If we get a 401, try to refresh token and retry once
        if (response.code == 401 && token != null) {
            Log.d(TAG, "Got 401, attempting token refresh...")
            response.close()

            val refreshedToken = refreshToken()
            if (refreshedToken != null) {
                Log.d(TAG, "Token refreshed successfully, retrying request")
                val newBuilder = originalRequest.newBuilder()
                    .header("Authorization", "Bearer $refreshedToken")
                    .header("Accept", "application/json")
                if (subscriptionStatus.isActive) {
                    newBuilder.header("x-subscription-active", "true")
                }
                return chain.proceed(newBuilder.build())
            } else {
                Log.w(TAG, "Token refresh failed")
            }
        }

        return response
    }

    /**
     * Get a valid token, refreshing if expired
     */
    private fun getValidToken(): String? {
        val currentToken = tokenManager.accessToken ?: return null

        // Check if token is expired (with 60 second buffer)
        if (tokenManager.tokenExpiry - System.currentTimeMillis() < 60_000) {
            Log.d(TAG, "Token expired or expiring soon, refreshing...")
            return refreshToken() ?: currentToken
        }

        return currentToken
    }

    /**
     * Refresh the access token using Supabase
     * IMPORTANT: We must set the session first to ensure we refresh the CORRECT user's session,
     * not a cached Google OAuth session from a previous login.
     */
    private fun refreshToken(): String? {
        return runBlocking {
            try {
                val currentAccessToken = tokenManager.accessToken
                val refreshToken = tokenManager.refreshToken
                if (refreshToken == null || currentAccessToken == null) {
                    Log.w(TAG, "No refresh token available")
                    return@runBlocking null
                }

                // First, set the current session to ensure Supabase uses the correct user
                // This prevents Supabase from using a cached session from a different auth provider
                try {
                    supabase.auth.retrieveUser(currentAccessToken)
                    supabase.auth.refreshCurrentSession()
                } catch (e: Exception) {
                    Log.d(TAG, "retrieveUser failed, trying direct refresh: ${e.message}")
                }

                // Use the refresh token to get a new access token
                val session = supabase.auth.refreshSession(refreshToken)

                // Verify the refreshed session belongs to the same user
                val currentUserId = tokenManager.userId
                if (currentUserId != null && session.user?.id != currentUserId) {
                    Log.e(TAG, "Session refresh returned different user! Expected: $currentUserId, Got: ${session.user?.id}")
                    // Don't save the wrong session - return current token and let it fail naturally
                    return@runBlocking currentAccessToken
                }

                Log.d(TAG, "Session refreshed successfully for user: ${session.user?.id}")
                tokenManager.saveTokens(
                    accessToken = session.accessToken,
                    refreshToken = session.refreshToken,
                    expiresAt = session.expiresAt?.epochSeconds?.times(1000) ?: 0L,
                    userId = session.user?.id
                )
                session.accessToken
            } catch (e: Exception) {
                Log.e(TAG, "Failed to refresh token: ${e.message}", e)
                null
            }
        }
    }
}
