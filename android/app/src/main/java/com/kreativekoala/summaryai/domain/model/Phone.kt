package com.kreativekoala.summaryai.domain.model

import androidx.annotation.StringRes
import com.kreativekoala.summaryai.R

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

    @get:StringRes
    val labelRes: Int
        get() = when (this) {
            INITIATED -> R.string.status_initiated
            RINGING -> R.string.status_ringing
            IN_PROGRESS -> R.string.status_in_progress
            RECORDING -> R.string.recording_fallback
            COMPLETED -> R.string.completed
            FAILED -> R.string.failed
            BUSY -> R.string.status_busy
            NO_ANSWER -> R.string.status_no_answer
            CANCELLED -> R.string.status_cancelled
        }

    companion object {
        /** The server's wire value; anything unknown reads as failed. */
        fun fromWire(value: String?): PhoneCallStatus =
            entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: FAILED
    }
}

/** US and Canada numbers as (415) 555-0100; anything else unchanged. */
fun formatPhoneNumber(phone: String): String =
    if (phone.startsWith("+1") && phone.length == 12) {
        "+1 (${phone.substring(2, 5)}) ${phone.substring(5, 8)}-${phone.substring(8)}"
    } else {
        phone
    }

/** A number the server has registered as the user's own caller ID. */
data class VerifiedPhone(
    val id: String,
    val phoneNumber: String
) {
    val formattedPhoneNumber: String get() = formatPhoneNumber(phoneNumber)
}

data class PhoneCall(
    val id: String,
    val fromNumber: String,
    val toNumber: String,
    val toName: String?,
    val status: PhoneCallStatus,
    val recordingDuration: Int?,
    val recordingId: String?,
    val startedAt: String?,
    val createdAt: String,
    val incoming: Boolean = false,
    val agent: AgentReport? = null
) {
    val formattedToNumber: String get() = formatPhoneNumber(toNumber)

    val formattedDuration: String
        get() {
            val duration = durationSeconds ?: return "--:--"
            return String.format(java.util.Locale.US, "%d:%02d", duration / 60, duration % 60)
        }

    val durationSeconds: Int? get() = recordingDuration ?: agent?.durationSeconds
}

data class AgentTurn(val fromAgent: Boolean, val text: String)

/** What the agent reported about a call it took. */
data class AgentReport(
    val summary: String?,
    val durationSeconds: Int?,
    val transcript: List<AgentTurn>,
    /** Name and value of each thing the agent collected. */
    val collected: List<Pair<String, String>>
)
