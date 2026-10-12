package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// MARK: - Integrations (webhook / Slack / Notion)

data class IntegrationDto(
    val kind: String,
    val enabled: Boolean,
    val configured: Boolean = true,
    @SerializedName("display_host") val displayHost: String? = null,
    @SerializedName("has_secret") val hasSecret: Boolean = false,
    @SerializedName("database_id") val databaseId: String? = null,
    @SerializedName("last_status") val lastStatus: String? = null,
    @SerializedName("last_error") val lastError: String? = null,
    @SerializedName("last_delivered_at") val lastDeliveredAt: String? = null
)

data class IntegrationsResponse(
    val integrations: List<IntegrationDto>
)

data class IntegrationResponse(
    val integration: IntegrationDto
)

data class IntegrationUpsertRequest(
    val url: String? = null,
    val secret: String? = null,
    @SerializedName("database_id") val databaseId: String? = null,
    val enabled: Boolean? = null
)

data class IntegrationTestResponse(
    val ok: Boolean,
    @SerializedName("response_status") val responseStatus: Int? = null,
    val error: String? = null
)

data class IntegrationDeliveryDto(
    val id: String,
    val kind: String,
    val event: String,
    val status: String,
    val attempts: Int = 1,
    val error: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

data class IntegrationDeliveriesResponse(
    val deliveries: List<IntegrationDeliveryDto>
)

// MARK: - Meeting analytics

data class SpeakerStatsDto(
    @SerializedName("speaker_index") val speakerIndex: Int,
    val name: String,
    @SerializedName("talk_time_seconds") val talkTimeSeconds: Double,
    @SerializedName("talk_share") val talkShare: Double,
    @SerializedName("word_count") val wordCount: Int,
    @SerializedName("question_count") val questionCount: Int,
    @SerializedName("longest_monologue_seconds") val longestMonologueSeconds: Double
)

data class MeetingAnalyticsDto(
    val speakers: List<SpeakerStatsDto>,
    @SerializedName("total_talk_seconds") val totalTalkSeconds: Double,
    @SerializedName("total_words") val totalWords: Int,
    @SerializedName("total_questions") val totalQuestions: Int,
    @SerializedName("longest_monologue_seconds") val longestMonologueSeconds: Double,
    @SerializedName("longest_monologue_speaker") val longestMonologueSpeaker: String? = null,
    val basis: String = "time"
)

data class MeetingAnalyticsResponse(
    val analytics: MeetingAnalyticsDto
)
