package com.kreativekoala.summaryai.domain.model

/**
 * Phone call status enum for domain layer
 */
enum class PhoneCallStatus {
    INITIATED,
    RINGING,
    IN_PROGRESS,
    RECORDING,
    COMPLETED,
    FAILED,
    BUSY,
    NO_ANSWER,
    CANCELLED;

    val displayName: String
        get() = when (this) {
            INITIATED -> "Initiated"
            RINGING -> "Ringing"
            IN_PROGRESS -> "In Progress"
            RECORDING -> "Recording"
            COMPLETED -> "Completed"
            FAILED -> "Failed"
            BUSY -> "Busy"
            NO_ANSWER -> "No Answer"
            CANCELLED -> "Cancelled"
        }

    val isActive: Boolean
        get() = when (this) {
            INITIATED, RINGING, IN_PROGRESS, RECORDING -> true
            COMPLETED, FAILED, BUSY, NO_ANSWER, CANCELLED -> false
        }
}

/**
 * Verified phone number domain model
 */
data class VerifiedPhone(
    val id: String,
    val phoneNumber: String,
    val verifiedAt: String?,
    val createdAt: String
) {
    val formattedPhoneNumber: String
        get() = formatPhoneNumber(phoneNumber)

    private fun formatPhoneNumber(phone: String): String {
        return if (phone.startsWith("+1") && phone.length == 12) {
            val area = phone.substring(2, 5)
            val prefix = phone.substring(5, 8)
            val line = phone.substring(8)
            "($area) $prefix-$line"
        } else {
            phone
        }
    }
}

/**
 * Phone call domain model
 */
data class PhoneCall(
    val id: String,
    val userId: String,
    val fromNumber: String,
    val toNumber: String,
    val toName: String?,
    val twilioCallSid: String?,
    val conferenceSid: String?,
    val conferenceName: String?,
    val recordingSid: String?,
    val status: PhoneCallStatus,
    val isRecording: Boolean,
    val recordingUrl: String?,
    val recordingDuration: Int?,
    val recordingId: String?,
    val startedAt: String?,
    val answeredAt: String?,
    val recordingStartedAt: String?,
    val endedAt: String?,
    val createdAt: String,
    val updatedAt: String?
) {
    val formattedToNumber: String
        get() = formatPhoneNumber(toNumber)

    val formattedFromNumber: String
        get() = formatPhoneNumber(fromNumber)

    val formattedDuration: String
        get() {
            val duration = recordingDuration ?: return "--:--"
            val mins = duration / 60
            val secs = duration % 60
            return String.format("%d:%02d", mins, secs)
        }

    private fun formatPhoneNumber(phone: String): String {
        return if (phone.startsWith("+1") && phone.length == 12) {
            val area = phone.substring(2, 5)
            val prefix = phone.substring(5, 8)
            val line = phone.substring(8)
            "($area) $prefix-$line"
        } else {
            phone
        }
    }
}
