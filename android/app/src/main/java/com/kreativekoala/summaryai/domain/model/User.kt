package com.kreativekoala.summaryai.domain.model

/**
 * Authentication provider
 */
enum class AuthProvider {
    GOOGLE,
    APPLE,
    EMAIL;

    val displayName: String
        get() = when (this) {
            GOOGLE -> "Google"
            APPLE -> "Apple"
            EMAIL -> "Email"
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

    val displayName: String
        get() = when (this) {
            FREE -> "Free"
            TRIAL -> "Trial"
            ACTIVE -> "Pro"
            EXPIRED -> "Expired"
            CANCELLED -> "Cancelled"
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
