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
    val phones: List<VerifiedPhoneDto>? = null
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
    @SerializedName("created_at") val createdAt: String
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
