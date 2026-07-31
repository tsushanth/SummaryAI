package com.kreativekoala.summaryai.data.api.coaching

import com.google.gson.annotations.SerializedName

/**
 * Wire types for the `/api/coaching/...` endpoints. See backend's
 * `coaching.ts` + iOS `CoachingModels.swift` for the parallel definitions.
 */

enum class CoachingPersonaKey(val key: String, val displayName: String) {
    SalesDiscovery("sales_discovery", "Sales Discovery");

    companion object {
        fun fromKey(key: String?): CoachingPersonaKey =
            entries.firstOrNull { it.key == key } ?: SalesDiscovery
    }
}

data class CoachingCredits(
    val balance: Int,
    @SerializedName("by_source") val bySource: Map<String, Int>?
) {
    val hasCredits: Boolean get() = balance > 0
}

data class CoachingClaimFreeResponse(
    val granted: Boolean,
    val balance: Int,
    @SerializedName("free_tier_credits") val freeTierCredits: Int
)

data class CoachingDebugGrantResponse(
    val granted: Int,
    val balance: Int
)

data class CoachingStartSessionRequest(
    @SerializedName("recording_id") val recordingId: String,
    val persona: String
)

data class CoachingStartSessionResponse(
    @SerializedName("session_id") val sessionId: String,
    val persona: String
)

data class CoachingInsight(
    val id: String,
    @SerializedName("session_id") val sessionId: String,
    val type: String,         // "question" | "objection" | "signal" | "gap"
    val text: String,
    val urgency: String,      // "now" | "soon" | "before-end"
    @SerializedName("transcript_offset_seconds") val transcriptOffsetSeconds: Int?,
    @SerializedName("emitted_at") val emittedAt: String
)

data class CoachingInsightsResponse(
    val session: CoachingSessionMeta?,
    val insights: List<CoachingInsight>
)

data class CoachingSessionMeta(
    @SerializedName("user_id") val userId: String?,
    val persona: String?,
    @SerializedName("started_at") val startedAt: String?,
    @SerializedName("ended_at") val endedAt: String?,
    @SerializedName("insight_count") val insightCount: Int?,
    val refunded: Boolean?
)

data class CoachingEndResponse(
    val ended: Boolean,
    val refunded: Boolean
)

data class CoachingGooglePlayVerifyRequest(
    @SerializedName("purchase_token") val purchaseToken: String,
    @SerializedName("product_id") val productId: String
)

data class CoachingGooglePlayVerifyResponse(
    val granted: Boolean,
    @SerializedName("already_existed") val alreadyExisted: Boolean,
    val balance: Int,
    @SerializedName("expires_at") val expiresAt: String?
)
