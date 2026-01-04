package com.kreativekoala.summaryai.data.api

import com.kreativekoala.summaryai.data.local.TokenManager
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp interceptor that adds Authorization header to requests
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        // Skip auth for certain endpoints
        val skipAuth = originalRequest.url.encodedPath.contains("/health") ||
                originalRequest.url.encodedPath.contains("/webhooks")

        if (skipAuth) {
            return chain.proceed(originalRequest)
        }

        val token = tokenManager.accessToken

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

        return chain.proceed(request)
    }
}
