package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// MARK: - Phone Call Status

enum class PhoneCallStatus {
    @SerializedName("initiated") INITIATED,
    @SerializedName("ringing") RINGING,
    @SerializedName("in_progress") IN_PROGRESS,
    @SerializedName("recording") RECORDING,
    @SerializedName("completed") COMPLETED,
    @SerializedName("failed") FAILED,
    @SerializedName("busy") BUSY,
    @SerializedName("no_answer") NO_ANSWER,
    @SerializedName("cancelled") CANCELLED
}

// MARK: - Verified Phone

data class VerifiedPhoneDto(
    val id: String,
    @SerializedName("phone_number") val phoneNumber: String,
    @SerializedName("verified_at") val verifiedAt: String?,
    @SerializedName("created_at") val createdAt: String
)

// MARK: - Phone Call

data class PhoneCallDto(
    val id: String,
    @SerializedName("user_id") val userId: String,
    @SerializedName("from_number") val fromNumber: String,
    @SerializedName("to_number") val toNumber: String,
    @SerializedName("to_name") val toName: String?,
    @SerializedName("twilio_call_sid") val twilioCallSid: String?,
    @SerializedName("conference_sid") val conferenceSid: String?,
    @SerializedName("conference_name") val conferenceName: String?,
    @SerializedName("recording_sid") val recordingSid: String?,
    val status: PhoneCallStatus,
    @SerializedName("is_recording") val isRecording: Boolean,
    @SerializedName("recording_url") val recordingUrl: String?,
    @SerializedName("recording_duration") val recordingDuration: Int?,
    @SerializedName("recording_id") val recordingId: String?,
    @SerializedName("started_at") val startedAt: String?,
    @SerializedName("answered_at") val answeredAt: String?,
    @SerializedName("recording_started_at") val recordingStartedAt: String?,
    @SerializedName("ended_at") val endedAt: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String?
)

// MARK: - API Requests

data class SendVerificationRequest(
    @SerializedName("phone_number") val phoneNumber: String
)

data class CheckVerificationRequest(
    @SerializedName("phone_number") val phoneNumber: String,
    val code: String
)

data class InitiateCallRequest(
    val from: String,
    val to: String,
    @SerializedName("to_name") val toName: String? = null
)

// MARK: - API Responses

data class SendVerificationResponse(
    val message: String
)

data class CheckVerificationResponse(
    val verified: Boolean,
    val phone: VerifiedPhoneDto?
)

data class VerifiedPhonesResponse(
    val phones: List<VerifiedPhoneDto>
)

data class InitiateCallResponse(
    @SerializedName("call_id") val callId: String,
    val status: String,
    @SerializedName("twilio_call_sid") val twilioCallSid: String?
)

// VoIP response - returns call details for client-side VoIP calling
data class CreateCallResponse(
    @SerializedName("call_id") val callId: String,
    val status: String,
    @SerializedName("conference_name") val conferenceName: String,
    @SerializedName("to_number") val toNumber: String
)

data class VoipTokenResponse(
    val token: String
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

data class RecordingControlResponse(
    val recording: Boolean,
    @SerializedName("conference_name") val conferenceName: String?
)

data class HangupResponse(
    val ended: Boolean
)

data class DeletePhoneResponse(
    val deleted: Boolean
)
