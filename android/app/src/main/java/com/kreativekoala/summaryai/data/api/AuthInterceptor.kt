package com.kreativekoala.summaryai.data.api

import android.util.Log
import com.kreativekoala.summaryai.BuildConfig
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
    private val tokenManager: TokenManager
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

        // Get current token, refreshing if needed
        val token = getValidToken()

        val request = if (token != null) {
            originalRequest.newBuilder()
                .header("Authorization", "Bearer $token")
                .header("Accept", "application/json")
                .build()
        } else {
            originalRequest.newBuilder()
                .header("Accept", "application/json")
                .build()
        }

        val response = chain.proceed(request)

        // If we get a 401, try to refresh token and retry once
        if (response.code == 401 && token != null) {
            Log.d(TAG, "Got 401, attempting token refresh...")
            response.close()

            val refreshedToken = refreshToken()
            if (refreshedToken != null) {
                Log.d(TAG, "Token refreshed successfully, retrying request")
                val newRequest = originalRequest.newBuilder()
                    .header("Authorization", "Bearer $refreshedToken")
                    .header("Accept", "application/json")
                    .build()
                return chain.proceed(newRequest)
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
     */
    private fun refreshToken(): String? {
        return runBlocking {
            try {
                val refreshToken = tokenManager.refreshToken
                if (refreshToken == null) {
                    Log.w(TAG, "No refresh token available")
                    return@runBlocking null
                }

                // Use the refresh token to get a new access token
                val session = supabase.auth.refreshSession(refreshToken)

                Log.d(TAG, "Session refreshed successfully")
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
