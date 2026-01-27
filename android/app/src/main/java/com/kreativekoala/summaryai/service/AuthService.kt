package com.kreativekoala.summaryai.service

import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.auth.api.signin.GoogleSignIn
import com.google.android.gms.auth.api.signin.GoogleSignInClient
import com.google.android.gms.auth.api.signin.GoogleSignInOptions
import com.google.android.gms.common.api.ApiException
import com.kreativekoala.summaryai.BuildConfig
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.local.PreferencesManager
import com.kreativekoala.summaryai.data.local.TokenManager
import com.kreativekoala.summaryai.domain.model.AuthProvider
import com.kreativekoala.summaryai.domain.model.AuthState
import com.kreativekoala.summaryai.domain.model.SubscriptionStatus
import com.kreativekoala.summaryai.domain.model.User
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.Google
import io.github.jan.supabase.gotrue.providers.builtin.Email
import io.github.jan.supabase.gotrue.providers.builtin.IDToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "AuthService"

/**
 * Authentication service handling Google Sign-In with Supabase
 */
@Singleton
class AuthService @Inject constructor(
    @ApplicationContext private val context: Context,
    private val tokenManager: TokenManager,
    private val preferencesManager: PreferencesManager,
    private val api: SummaryAIApi
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _authState = MutableStateFlow(AuthState())
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    // Supabase client
    private val supabase: SupabaseClient = createSupabaseClient(
        supabaseUrl = BuildConfig.SUPABASE_URL,
        supabaseKey = BuildConfig.SUPABASE_ANON_KEY
    ) {
        install(Auth)
    }

    // Google Sign-In client
    private val googleSignInClient: GoogleSignInClient by lazy {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .requestEmail()
            .build()
        GoogleSignIn.getClient(context, gso)
    }

    init {
        // Check for existing session on init
        scope.launch {
            checkExistingSession()
        }
    }

    /**
     * Check for existing session
     */
    private suspend fun checkExistingSession() {
        Log.i(TAG, "=== checkExistingSession starting ===")
        _authState.value = _authState.value.copy(isLoading = true)

        try {
            val hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            Log.i(TAG, "hasCompletedOnboarding: $hasCompletedOnboarding")
            Log.i(TAG, "tokenManager.isLoggedIn: ${tokenManager.isLoggedIn}, isTokenExpired: ${tokenManager.isTokenExpired}")

            // First check TokenManager - if we have valid tokens, user is authenticated
            if (tokenManager.isLoggedIn && !tokenManager.isTokenExpired) {
                Log.i(TAG, "TokenManager has valid tokens, checking Supabase session...")

                // Try to get/load the Supabase session
                var session = supabase.auth.currentSessionOrNull()

                // If Supabase doesn't have the session yet, try to restore it using the refresh token
                if (session == null && tokenManager.refreshToken != null) {
                    Log.i(TAG, "Supabase session null, trying to refresh using stored token...")
                    try {
                        session = supabase.auth.refreshSession(tokenManager.refreshToken!!)
                        Log.i(TAG, "Session refreshed successfully")
                    } catch (e: Exception) {
                        Log.w(TAG, "Failed to refresh session: ${e.message}")
                    }
                }

                if (session != null) {
                    // Sync tokens back to TokenManager to keep them fresh
                    tokenManager.saveTokens(
                        accessToken = session.accessToken,
                        refreshToken = session.refreshToken,
                        expiresAt = session.expiresAt?.epochSeconds?.times(1000) ?: 0L,
                        userId = session.user?.id
                    )

                    val user = session.user
                    Log.i(TAG, "=== User authenticated: ${user?.email} ===")
                    _authState.value = AuthState(
                        isAuthenticated = true,
                        isLoading = false,
                        user = User(
                            id = user?.id ?: "",
                            email = user?.email ?: "",
                            fullName = user?.userMetadata?.get("full_name")?.toString(),
                            avatarUrl = user?.userMetadata?.get("avatar_url")?.toString(),
                            provider = AuthProvider.GOOGLE,
                            subscriptionStatus = SubscriptionStatus.FREE,
                            subscriptionExpiresAt = null
                        ),
                        hasCompletedOnboarding = hasCompletedOnboarding
                    )
                    return
                }
            }

            // Also check if Supabase has a session even if TokenManager doesn't
            val supabaseSession = supabase.auth.currentSessionOrNull()
            if (supabaseSession != null) {
                Log.i(TAG, "Found Supabase session, syncing to TokenManager...")
                tokenManager.saveTokens(
                    accessToken = supabaseSession.accessToken,
                    refreshToken = supabaseSession.refreshToken,
                    expiresAt = supabaseSession.expiresAt?.epochSeconds?.times(1000) ?: 0L,
                    userId = supabaseSession.user?.id
                )

                val user = supabaseSession.user
                Log.i(TAG, "=== User authenticated from Supabase: ${user?.email} ===")
                _authState.value = AuthState(
                    isAuthenticated = true,
                    isLoading = false,
                    user = User(
                        id = user?.id ?: "",
                        email = user?.email ?: "",
                        fullName = user?.userMetadata?.get("full_name")?.toString(),
                        avatarUrl = user?.userMetadata?.get("avatar_url")?.toString(),
                        provider = AuthProvider.GOOGLE,
                        subscriptionStatus = SubscriptionStatus.FREE,
                        subscriptionExpiresAt = null
                    ),
                    hasCompletedOnboarding = hasCompletedOnboarding
                )
                return
            }

            // No valid session found anywhere
            Log.i(TAG, "=== No valid session, clearing tokens ===")
            tokenManager.clearTokens()
            _authState.value = AuthState(
                isAuthenticated = false,
                isLoading = false,
                hasCompletedOnboarding = hasCompletedOnboarding
            )
        } catch (e: Exception) {
            _authState.value = AuthState(
                isAuthenticated = false,
                isLoading = false,
                error = e.message
            )
        }
    }

    /**
     * Get Google Sign-In intent
     */
    fun getGoogleSignInIntent(): Intent {
        return googleSignInClient.signInIntent
    }

    /**
     * Handle Google Sign-In result
     */
    suspend fun handleGoogleSignInResult(data: Intent?): Result<Unit> {
        return try {
            _authState.value = _authState.value.copy(isLoading = true, error = null)

            val task = GoogleSignIn.getSignedInAccountFromIntent(data)
            val account = task.getResult(ApiException::class.java)

            // Get Google ID token
            val idToken = account?.idToken
                ?: return Result.failure(Exception("No ID token received"))

            Log.d(TAG, "Got Google ID token, exchanging with Supabase...")

            // Exchange Google ID token directly with Supabase (no web redirect)
            supabase.auth.signInWith(IDToken) {
                this.idToken = idToken
                provider = Google
            }

            val session = supabase.auth.currentSessionOrNull()
                ?: return Result.failure(Exception("Failed to get session"))

            Log.d(TAG, "Got Supabase session for user: ${session.user?.email}")

            // Save tokens
            tokenManager.saveTokens(
                accessToken = session.accessToken,
                refreshToken = session.refreshToken,
                expiresAt = session.expiresAt?.epochSeconds?.times(1000) ?: 0L,
                userId = session.user?.id
            )

            val user = session.user
            _authState.value = AuthState(
                isAuthenticated = true,
                isLoading = false,
                user = User(
                    id = user?.id ?: "",
                    email = user?.email ?: "",
                    fullName = user?.userMetadata?.get("full_name")?.toString()
                        ?: account.displayName,
                    avatarUrl = user?.userMetadata?.get("avatar_url")?.toString()
                        ?: account.photoUrl?.toString(),
                    provider = AuthProvider.GOOGLE,
                    subscriptionStatus = SubscriptionStatus.FREE,
                    subscriptionExpiresAt = null
                ),
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            )

            Result.success(Unit)
        } catch (e: ApiException) {
            Log.e(TAG, "Google sign-in API exception: ${e.statusCode}", e)
            _authState.value = _authState.value.copy(
                isLoading = false,
                error = "Google sign-in failed: ${e.statusCode}"
            )
            Result.failure(e)
        } catch (e: Exception) {
            Log.e(TAG, "Sign-in exception: ${e.message}", e)
            _authState.value = _authState.value.copy(
                isLoading = false,
                error = e.message
            )
            Result.failure(e)
        }
    }

    /**
     * Sign out
     */
    suspend fun signOut() {
        try {
            supabase.auth.signOut()
            googleSignInClient.signOut()
        } catch (e: Exception) {
            // Ignore errors during sign out
        } finally {
            tokenManager.clearTokens()
            _authState.value = AuthState(
                isAuthenticated = false,
                isLoading = false,
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            )
        }
    }

    /**
     * Delete account
     */
    suspend fun deleteAccount(): Result<Unit> {
        return try {
            api.deleteAccount()
            signOut()
            preferencesManager.clearAll()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Set onboarding completed
     */
    suspend fun setOnboardingCompleted() {
        preferencesManager.setOnboardingCompleted(true)
        _authState.value = _authState.value.copy(hasCompletedOnboarding = true)
    }

    /**
     * Clear error
     */
    fun clearError() {
        _authState.value = _authState.value.copy(error = null)
    }

    /**
     * Sign up with email and password
     */
    suspend fun signUpWithEmail(email: String, password: String): Result<Unit> {
        return try {
            _authState.value = _authState.value.copy(isLoading = true, error = null)

            Log.d(TAG, "Signing up with email: $email")

            try {
                supabase.auth.signUpWith(Email) {
                    this.email = email
                    this.password = password
                }
            } catch (signupError: Exception) {
                // Check if user already exists
                val errorMsg = signupError.message?.lowercase() ?: ""
                if (errorMsg.contains("already") || errorMsg.contains("exists") || errorMsg.contains("registered")) {
                    _authState.value = _authState.value.copy(isLoading = false)
                    return Result.failure(Exception("An account with this email already exists. Please sign in instead."))
                }
                throw signupError
            }

            // After signup, try to get session or sign in
            var session = supabase.auth.currentSessionOrNull()

            if (session == null) {
                // If no session after signup, try signing in
                Log.d(TAG, "No session after signup, attempting sign in...")
                supabase.auth.signInWith(Email) {
                    this.email = email
                    this.password = password
                }
                session = supabase.auth.currentSessionOrNull()
            }

            if (session == null) {
                return Result.failure(Exception("Account created but failed to sign in. Please try signing in."))
            }

            Log.d(TAG, "Got Supabase session for user: ${session.user?.email}")

            // Save tokens
            tokenManager.saveTokens(
                accessToken = session.accessToken,
                refreshToken = session.refreshToken,
                expiresAt = session.expiresAt?.epochSeconds?.times(1000) ?: 0L,
                userId = session.user?.id
            )

            val user = session.user
            _authState.value = AuthState(
                isAuthenticated = true,
                isLoading = false,
                user = User(
                    id = user?.id ?: "",
                    email = user?.email ?: "",
                    fullName = user?.userMetadata?.get("full_name")?.toString(),
                    avatarUrl = user?.userMetadata?.get("avatar_url")?.toString(),
                    provider = AuthProvider.EMAIL,
                    subscriptionStatus = SubscriptionStatus.FREE,
                    subscriptionExpiresAt = null
                ),
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            )

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Email sign-up exception: ${e.message}", e)
            _authState.value = _authState.value.copy(
                isLoading = false,
                error = e.message ?: "Sign up failed"
            )
            Result.failure(e)
        }
    }

    /**
     * Sign in with email and password
     */
    suspend fun signInWithEmail(email: String, password: String): Result<Unit> {
        return try {
            _authState.value = _authState.value.copy(isLoading = true, error = null)

            Log.d(TAG, "Signing in with email: $email")

            supabase.auth.signInWith(Email) {
                this.email = email
                this.password = password
            }

            val session = supabase.auth.currentSessionOrNull()
                ?: return Result.failure(Exception("Failed to get session"))

            Log.d(TAG, "Got Supabase session for user: ${session.user?.email}")

            // Save tokens
            tokenManager.saveTokens(
                accessToken = session.accessToken,
                refreshToken = session.refreshToken,
                expiresAt = session.expiresAt?.epochSeconds?.times(1000) ?: 0L,
                userId = session.user?.id
            )

            val user = session.user
            _authState.value = AuthState(
                isAuthenticated = true,
                isLoading = false,
                user = User(
                    id = user?.id ?: "",
                    email = user?.email ?: "",
                    fullName = user?.userMetadata?.get("full_name")?.toString(),
                    avatarUrl = user?.userMetadata?.get("avatar_url")?.toString(),
                    provider = AuthProvider.EMAIL,
                    subscriptionStatus = SubscriptionStatus.FREE,
                    subscriptionExpiresAt = null
                ),
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            )

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Email sign-in exception: ${e.message}", e)
            _authState.value = _authState.value.copy(
                isLoading = false,
                error = e.message ?: "Sign in failed"
            )
            Result.failure(e)
        }
    }

    /**
     * Sign in as demo user (for app store reviewers)
     * This creates a local-only demo session without server authentication
     */
    suspend fun signInAsDemo() {
        _authState.value = _authState.value.copy(isLoading = true)

        // Create a demo user with a fake ID
        val demoUser = User(
            id = "demo-user-${System.currentTimeMillis()}",
            email = "demo@meetingmind.app",
            fullName = "Demo User",
            avatarUrl = null,
            provider = AuthProvider.GOOGLE,
            subscriptionStatus = SubscriptionStatus.FREE,
            subscriptionExpiresAt = null
        )

        // Save a fake token so the app thinks we're logged in
        // This won't work for actual API calls, but allows reviewers to explore the UI
        tokenManager.saveTokens(
            accessToken = "demo-token-${System.currentTimeMillis()}",
            refreshToken = null,
            expiresAt = System.currentTimeMillis() + 24 * 60 * 60 * 1000, // 24 hours
            userId = demoUser.id
        )

        _authState.value = AuthState(
            isAuthenticated = true,
            isLoading = false,
            user = demoUser,
            hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
        )
    }
}
