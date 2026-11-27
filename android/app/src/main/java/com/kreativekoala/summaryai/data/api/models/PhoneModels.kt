package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// MARK: - Phone calls (backend: /api/phone)

data class VerifiedPhoneDto(
    val id: String,
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("verified_at") val verifiedAt: String?,
    @SerializedName("created_at") val createdAt: String?
)

/** What the server allows this account. `enabled = false` hides the Phone tab; every other field is then absent. */
data class PhoneStatusResponse(
    val enabled: Boolean = false,
    @SerializedName("consent_version") val consentVersion: String? = null,
    @SerializedName("call_languages") val callLanguages: List<String>? = null,
    @SerializedName("max_verified_numbers") val maxVerifiedNumbers: Int? = null,
    @SerializedName("minutes_per_month") val minutesPerMonth: Int? = null,
    @SerializedName("minutes_left") val minutesLeft: Int? = null,
    @SerializedName("service_available") val serviceAvailable: Boolean? = null,
    @SerializedName("business_answered") val businessAnswered: Boolean? = null,
    val phones: List<VerifiedPhoneDto>? = null,
    /** Whether the own-number screens are shown: the free trial or purchase is on, or the account has a number. */
    @SerializedName("own_number") val ownNumber: Boolean? = null
)

data class StartVerificationRequest(
    @SerializedName("phone_number") val phoneNumber: String
)

data class StartVerificationResponse(
    @SerializedName("verification_id") val verificationId: String,
    /** The person types this on the phone keypad during the verification call. Never stored or logged. */
    val code: String,
    @SerializedName("expires_in_seconds") val expiresInSeconds: Int,
    @SerializedName("phone_number") val phoneNumber: String
)

data class VerificationStatusResponse(
    /** pending, verified or failed */
    val status: String,
    val reason: String? = null,
    val phone: VerifiedPhoneDto? = null
)

data class StartCallRequest(
    val to: String,
    @SerializedName("from_id") val fromId: String?,
    @SerializedName("to_name") val toName: String?,
    @SerializedName("consent_version") val consentVersion: String,
    @SerializedName("output_language") val outputLanguage: String?,
    @SerializedName("call_language") val callLanguage: String
)

data class StartCallResponse(
    @SerializedName("call_id") val callId: String,
    /** Short-lived token for the calling SDK, valid for this call only. */
    val token: String,
    @SerializedName("to_number") val toNumber: String,
    @SerializedName("from_number") val fromNumber: String,
    @SerializedName("time_limit_seconds") val timeLimitSeconds: Int,
    @SerializedName("minutes_left") val minutesLeft: Int
)

data class PhoneCallDto(
    val id: String,
    @SerializedName("from_number") val fromNumber: String,
    @SerializedName("to_number") val toNumber: String,
    @SerializedName("to_name") val toName: String?,
    val status: String?,
    @SerializedName("recording_duration") val recordingDuration: Int?,
    @SerializedName("recording_id") val recordingId: String?,
    @SerializedName("started_at") val startedAt: String?,
    @SerializedName("created_at") val createdAt: String,
    /** "in" or "out" */
    val direction: String? = null,
    /** What the agent reported, when one took the call. */
    val agent: AgentReportDto? = null
)

data class AgentReportDto(
    val summary: String? = null,
    @SerializedName("duration_seconds") val durationSeconds: Int? = null,
    val transcript: List<AgentTurnDto>? = null,
    /** What the agent was asked to collect, as name and value. */
    val collected: Map<String, String>? = null
)

data class AgentTurnDto(
    /** agent or caller */
    val role: String? = null,
    val text: String? = null
)

data class ListPhoneCallsResponse(
    val calls: List<PhoneCallDto>,
    val total: Int,
    val limit: Int,
    val offset: Int
)

data class PhoneCallResponse(
    val call: PhoneCallDto
)

data class HangupResponse(
    val ended: Boolean
)

data class PhoneEventRequest(
    val step: String,
    val country: String?,
    val test: Boolean?
)

/** "Is this for a business?": business, personal or skipped. */
data class PhoneProfileRequest(
    val business: String,
    @SerializedName("business_type") val businessType: String?,
    val context: String,
    val country: String?,
    val test: Boolean?
)

// MARK: - Own number and phone agent

/** What the account has and what it can get. Amounts, prices and the trial all come from the server. */
data class PhonePlanResponse(
    @SerializedName("purchase_enabled") val purchaseEnabled: Boolean = false,
    @SerializedName("product_id") val productId: String? = null,
    @SerializedName("price_label") val priceLabel: String? = null,
    @SerializedName("call_minutes") val callMinutes: Int? = null,
    @SerializedName("agent_minutes") val agentMinutes: Int? = null,
    val subscription: PhoneSubscriptionDto? = null,
    val trial: PhoneTrialDto? = null,
    val number: OwnNumberDto? = null,
    @SerializedName("agents_available") val agentsAvailable: Boolean = false,
    val agent: OwnAgentDto? = null
)

data class PhoneSubscriptionDto(
    @SerializedName("expires_at") val expiresAt: String? = null,
    @SerializedName("call_minutes_left") val callMinutesLeft: Int? = null,
    @SerializedName("agent_minutes_left") val agentMinutesLeft: Int? = null
)

data class PhoneTrialDto(
    /** This account can still start the trial. */
    val offered: Boolean = false,
    val days: Int? = null,
    @SerializedName("agent_minutes") val agentMinutes: Int? = null,
    val active: ActiveTrialDto? = null,
    val used: Boolean = false
)

data class ActiveTrialDto(
    @SerializedName("ends_at") val endsAt: String? = null,
    @SerializedName("agent_minutes_left") val agentMinutesLeft: Int? = null
)

data class OwnNumberDto(
    val id: String,
    @SerializedName("phone_number") val phoneNumber: String,
    val country: String? = null
)

data class OwnAgentDto(
    val description: String? = null,
    val language: String? = null
)

data class GetNumberRequest(
    val country: String,
    @SerializedName("area_code") val areaCode: String?,
    /** True only after the person confirmed the free trial. */
    @SerializedName("confirm_trial") val confirmTrial: Boolean?
)

data class ReleaseNumberResponse(val released: Boolean = false)

data class AgentLanguagesResponse(val languages: List<AgentLanguageDto>? = null)

data class AgentLanguageDto(val code: String, val name: String? = null)

data class SetAgentRequest(val prompt: String, val language: String)

data class SetAgentResponse(
    val description: String? = null,
    val language: String? = null,
    /** "ability_removed": part of the description asks for something the agent does not do. */
    val warnings: List<String>? = null
)

data class AgentDetailResponse(val prompt: String? = null, val language: String? = null)

data class PhonePurchaseRequest(
    @SerializedName("purchase_token") val purchaseToken: String,
    @SerializedName("product_id") val productId: String
)

data class PhonePurchaseResponse(@SerializedName("expires_at") val expiresAt: String? = null)
