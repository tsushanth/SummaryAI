package com.kreativekoala.summaryai.service

import com.kreativekoala.summaryai.R
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
import com.kreativekoala.summaryai.util.appLocaleContext
import dagger.hilt.android.qualifiers.ApplicationContext
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.gotrue.Auth
import io.github.jan.supabase.gotrue.auth
import io.github.jan.supabase.gotrue.providers.Google
import io.github.jan.supabase.gotrue.providers.builtin.Email
import io.github.jan.supabase.gotrue.providers.builtin.IDToken
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
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
    private val api: SummaryAIApi,
    private val supabase: SupabaseClient,
    private val sessionEvents: com.kreativekoala.summaryai.data.auth.SessionEvents
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _authState = MutableStateFlow(AuthState())
    val authState: StateFlow<AuthState> = _authState.asStateFlow()

    // Google Sign-In client
    private val googleSignInClient: GoogleSignInClient by lazy {
        val gso = GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
            .requestIdToken(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .requestEmail()
            .build()
        GoogleSignIn.getClient(context, gso)
    }

    init {
        // The HTTP layer reports a session that can no longer be refreshed: go back to sign-in cleanly
        scope.launch {
            sessionEvents.sessionLost.collect { onSessionLost() }
        }
        // Check for existing session on init
        scope.launch {
            checkExistingSession()
        }
    }

    /** The refresh token was rejected for good (tokens are already cleared): show sign-in instead of looping in 401s. */
    private suspend fun onSessionLost() {
        Log.w(TAG, "Session lost: returning to sign-in")
        tokenManager.clearTokens()
        _authState.value = AuthState(
            isAuthenticated = false,
            isLoading = false,
            hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
        )
    }

    /**
     * Check for existing session
     */
    private suspend fun checkExistingSession() {
        Log.i(TAG, "=== checkExistingSession starting ===")
        _authState.value = _authState.value.copy(isLoading = true)

        try {
            // The client loads its saved session asynchronously; wait for that before looking at it.
            kotlinx.coroutines.withTimeoutOrNull(5_000) { supabase.auth.awaitInitialization() }
            val hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            Log.i(TAG, "hasCompletedOnboarding: $hasCompletedOnboarding")
            Log.i(TAG, "tokenManager.isLoggedIn: ${tokenManager.isLoggedIn}, isTokenExpired: ${tokenManager.isTokenExpired}")

            // First check TokenManager - if we have valid tokens, user is authenticated
            if (tokenManager.isLoggedIn && !tokenManager.isTokenExpired) {
                Log.i(TAG, "TokenManager has valid tokens, checking Supabase session...")

                // The client's own session is the only source of truth. Our stored refresh token is a mirror that
                // may already have been rotated, so it is never replayed to the server.
                val session = supabase.auth.currentSessionOrNull()

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
                            fullName = user?.userMetadata.metaString("full_name"),
                            avatarUrl = user?.userMetadata.metaString("avatar_url"),
                            provider = user?.appMetadata.restoredProvider(),
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
                        fullName = user?.userMetadata.metaString("full_name"),
                        avatarUrl = user?.userMetadata.metaString("avatar_url"),
                        provider = user?.appMetadata.restoredProvider(),
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
            val onboardingCompleted = try {
                preferencesManager.hasCompletedOnboarding.first()
            } catch (_: Exception) {
                false
            }
            _authState.value = AuthState(
                isAuthenticated = false,
                isLoading = false,
                error = e.message,
                hasCompletedOnboarding = onboardingCompleted
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
     * Handle Google Sign-In result. Every way this can fail ends with a message the person can act on and a failure report;
     * closing the picker is neither.
     */
    suspend fun handleGoogleSignInResult(data: Intent?): Result<Unit> {
        // Step 1: Google Play services. Nothing on screen changes until there is an account to work with.
        val account = try {
            GoogleSignIn.getSignedInAccountFromIntent(data).getResult(ApiException::class.java)
        } catch (e: ApiException) {
            Log.e(TAG, "Google sign-in API exception: ${e.statusCode}", e)
            if (SignInFailure.isGoogleCancel(e.statusCode)) return Result.failure(Exception())
            report(e, "Google sign-in failed: status ${e.statusCode}", mapOf("status" to e.statusCode.toString()))
            return signInFailed(
                if (e.statusCode == SignInFailure.GOOGLE_NETWORK_ERROR) text(R.string.api_error_network)
                else text(R.string.auth_error_google_failed, e.statusCode),
                e
            )
        }

        val idToken = account?.idToken
        if (idToken == null) {
            report(null, "Google sign-in returned no ID token")
            return signInFailed(text(R.string.auth_error_no_id_token))
        }

        // Step 2: exchange the Google ID token with Supabase (no web redirect).
        _authState.value = _authState.value.copy(isLoading = true, error = null)
        val started = System.currentTimeMillis()
        var tries = 0
        return try {
            Log.d(TAG, "Got Google ID token, exchanging with Supabase...")
            SignInFailure.retryUnreachable {
                tries++
                supabase.auth.signInWith(IDToken) {
                    this.idToken = idToken
                    provider = Google
                }
            }

            val session = supabase.auth.currentSessionOrNull()
            if (session == null) {
                report(null, "Google sign-in ended with no session", mapOf("tries" to tries.toString()))
                return signInFailed(text(R.string.auth_error_no_session))
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
                    fullName = user?.userMetadata.metaString("full_name")
                        ?: account.displayName,
                    avatarUrl = user?.userMetadata.metaString("avatar_url")
                        ?: account.photoUrl?.toString(),
                    provider = AuthProvider.GOOGLE,
                    subscriptionStatus = SubscriptionStatus.FREE,
                    subscriptionExpiresAt = null
                ),
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            )

            Result.success(Unit)
        } catch (e: kotlinx.coroutines.CancellationException) {
            _authState.value = _authState.value.copy(isLoading = false)
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Sign-in exception: ${e.message}", e)
            // A refusal carries the request headers in its message, so only the fields picked in reportContext are sent.
            report(
                e.takeUnless { it is io.github.jan.supabase.exceptions.RestException },
                "Google sign-in token exchange failed: ${e.javaClass.simpleName}",
                SignInFailure.reportContext(e, tries, System.currentTimeMillis() - started)
            )
            signInFailed(
                when (SignInFailure.kindOf(e)) {
                    SignInFailure.Kind.UNREACHABLE -> text(R.string.api_error_network)
                    SignInFailure.Kind.REJECTED -> text(R.string.auth_error_server_rejected, SignInFailure.serverCode(e) ?: "")
                    SignInFailure.Kind.UNKNOWN -> text(R.string.auth_error_server_rejected, e.javaClass.simpleName)
                },
                e
            )
        }
    }

    private fun text(res: Int, vararg args: Any): String {
        val localized = appLocaleContext(context)
        return if (args.isEmpty()) localized.getString(res) else localized.getString(res, *args)
    }

    private fun report(t: Throwable?, message: String, context: Map<String, String> = emptyMap()) {
        com.kreativekoala.summaryai.FailureReporter.failure(
            flow = "google_sign_in", t = t, message = message, context = context
        )
    }

    /** Shows [message] on the sign-in screen. The screen reads it from [authState], which outlives the loading spinner. */
    private fun signInFailed(message: String, cause: Throwable? = null): Result<Unit> {
        _authState.value = _authState.value.copy(isLoading = false, error = message)
        return Result.failure(Exception(message, cause))
    }

    /** The exception's own text names addresses and library classes; an unreachable server gets plain words instead. */
    private fun emailErrorMessage(e: Exception): String? =
        if (SignInFailure.kindOf(e) == SignInFailure.Kind.UNREACHABLE) text(R.string.api_error_network) else e.message

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
            // signOut() only drops the saved session when its network call succeeds; never leave one behind
            try { supabase.auth.clearSession() } catch (_: Exception) {}
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
                    // Set on authState: the spinner replaced the screen, so a returned failure alone is never seen.
                    return signInFailed(text(R.string.auth_error_account_exists))
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
                return signInFailed(text(R.string.auth_error_signin_after_signup))
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
                    fullName = user?.userMetadata.metaString("full_name"),
                    avatarUrl = user?.userMetadata.metaString("avatar_url"),
                    provider = AuthProvider.EMAIL,
                    subscriptionStatus = SubscriptionStatus.FREE,
                    subscriptionExpiresAt = null
                ),
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            )

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Email sign-up exception: ${e.message}", e)
            signInFailed(emailErrorMessage(e) ?: context.getString(R.string.auth_error_signup_failed), e)
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
                ?: return signInFailed(text(R.string.auth_error_no_session))

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
                    fullName = user?.userMetadata.metaString("full_name"),
                    avatarUrl = user?.userMetadata.metaString("avatar_url"),
                    provider = AuthProvider.EMAIL,
                    subscriptionStatus = SubscriptionStatus.FREE,
                    subscriptionExpiresAt = null
                ),
                hasCompletedOnboarding = preferencesManager.hasCompletedOnboarding.first()
            )

            Result.success(Unit)
        } catch (e: Exception) {
            Log.e(TAG, "Email sign-in exception: ${e.message}", e)
            signInFailed(emailErrorMessage(e) ?: "Sign in failed", e)
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

/** Plain string value of a user-metadata field; JsonElement.toString() would keep the JSON quotes. */
/** Sign-in method recorded by Supabase in app_metadata; email accounts must not be labelled Google. */
private fun JsonObject?.restoredProvider(): AuthProvider =
    if (metaString("provider") == "email") AuthProvider.EMAIL else AuthProvider.GOOGLE

private fun JsonObject?.metaString(key: String): String? =
    (this?.get(key) as? JsonPrimitive)?.contentOrNull
