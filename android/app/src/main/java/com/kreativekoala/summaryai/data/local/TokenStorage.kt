package com.kreativekoala.summaryai.data.local

/**
 * What the HTTP layer needs from the token store. [TokenManager] is the encrypted on-device
 * implementation; tests use an in-memory one. The values here only MIRROR the Supabase client's own
 * session (the single source of truth for the refresh token); never replay them to /auth/v1/token
 * unless the client has no session at all.
 */
interface TokenStorage {
    var accessToken: String?
    var refreshToken: String?
    var tokenExpiry: Long
    var userId: String?
    val isLoggedIn: Boolean
    val isTokenExpired: Boolean
    fun saveTokens(accessToken: String, refreshToken: String?, expiresAt: Long, userId: String?)
    fun clearTokens()
}
