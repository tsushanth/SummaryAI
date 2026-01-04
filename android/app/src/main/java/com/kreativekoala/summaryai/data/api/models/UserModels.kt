package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// MARK: - Auth Provider
enum class AuthProvider {
    @SerializedName("google") GOOGLE,
    @SerializedName("apple") APPLE,
    @SerializedName("email") EMAIL
}

// MARK: - Subscription Status
enum class SubscriptionStatus {
    @SerializedName("free") FREE,
    @SerializedName("trial") TRIAL,
    @SerializedName("active") ACTIVE,
    @SerializedName("expired") EXPIRED,
    @SerializedName("cancelled") CANCELLED
}

// MARK: - User Profile
data class UserProfileDto(
    val id: String,
    val email: String,
    @SerializedName("full_name") val fullName: String?,
    @SerializedName("avatar_url") val avatarUrl: String?,
    val provider: AuthProvider,
    @SerializedName("subscription_status") val subscriptionStatus: SubscriptionStatus,
    @SerializedName("subscription_expires_at") val subscriptionExpiresAt: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String
)

// MARK: - API Responses

data class UserProfileResponse(
    val user: UserProfileDto
)

// MARK: - Error Response
data class ApiErrorResponse(
    val error: ApiErrorDetail
)

data class ApiErrorDetail(
    val code: String?,
    val message: String
)
