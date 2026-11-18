package com.kreativekoala.summaryai.domain.model

import androidx.annotation.StringRes
import com.kreativekoala.summaryai.R

/**
 * Authentication provider
 */
enum class AuthProvider {
    GOOGLE,
    APPLE,
    EMAIL;

    @get:StringRes
    val labelRes: Int
        get() = when (this) {
            GOOGLE -> R.string.auth_provider_google
            APPLE -> R.string.auth_provider_apple
            EMAIL -> R.string.auth_provider_email
        }
}

/**
 * Subscription status
 */
enum class SubscriptionStatus {
    FREE,
    TRIAL,
    ACTIVE,
    EXPIRED,
    CANCELLED;

    val isPro: Boolean
        get() = this in listOf(TRIAL, ACTIVE)

    @get:StringRes
    val labelRes: Int
        get() = when (this) {
            FREE -> R.string.free
            TRIAL -> R.string.status_trial
            ACTIVE -> R.string.status_pro
            EXPIRED -> R.string.status_expired
            CANCELLED -> R.string.status_cancelled
        }
}

/**
 * User profile domain model
 */
data class User(
    val id: String,
    val email: String,
    val fullName: String?,
    val avatarUrl: String?,
    val provider: AuthProvider,
    val subscriptionStatus: SubscriptionStatus,
    val subscriptionExpiresAt: String?
) {
    val displayName: String
        get() = fullName ?: email.substringBefore("@")

    val initials: String
        get() {
            val name = fullName ?: email
            val parts = name.split(" ")
            return when {
                parts.size >= 2 -> "${parts[0].firstOrNull() ?: ""}${parts[1].firstOrNull() ?: ""}"
                parts.isNotEmpty() -> parts[0].take(2)
                else -> "?"
            }.uppercase()
        }

    val isPro: Boolean
        get() = subscriptionStatus.isPro
}

/**
 * Authentication state
 */
data class AuthState(
    val isAuthenticated: Boolean = false,
    val isLoading: Boolean = true,
    val user: User? = null,
    val hasCompletedOnboarding: Boolean = false,
    val error: String? = null
)
