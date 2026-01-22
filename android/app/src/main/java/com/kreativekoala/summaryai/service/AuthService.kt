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
        _authState.value = _authState.value.copy(isLoading = true)

        try {
            val hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            val hasSkippedSignIn = preferencesManager.hasSkippedSignIn.first()

            if (tokenManager.isLoggedIn && !tokenManager.isTokenExpired) {
                // Try to refresh the session
                val session = supabase.auth.currentSessionOrNull()
                if (session != null) {
                    val user = session.user
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
                        hasCompletedOnboarding = hasCompletedOnboarding,
                        hasSkippedSignIn = false // Reset since user is now signed in
                    )
                    return
                }
            }

            // No valid session
            tokenManager.clearTokens()
            _authState.value = AuthState(
                isAuthenticated = false,
                isLoading = false,
                hasCompletedOnboarding = hasCompletedOnboarding,
                hasSkippedSignIn = hasSkippedSignIn
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
            // Clear skipped sign-in flag since user is now signed in
            preferencesManager.setSkippedSignIn(false)
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
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first(),
                hasSkippedSignIn = false
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
            // Reset skipped sign-in so user sees auth screen
            preferencesManager.setSkippedSignIn(false)
            _authState.value = AuthState(
                isAuthenticated = false,
                isLoading = false,
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first(),
                hasSkippedSignIn = false
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
     * Continue without sign in (guest mode)
     * Users can link their calendar later when they sign in
     */
    suspend fun continueWithoutSignIn() {
        preferencesManager.setSkippedSignIn(true)
        _authState.value = _authState.value.copy(hasSkippedSignIn = true)
    }

    /**
     * Clear error
     */
    fun clearError() {
        _authState.value = _authState.value.copy(error = null)
    }
}
