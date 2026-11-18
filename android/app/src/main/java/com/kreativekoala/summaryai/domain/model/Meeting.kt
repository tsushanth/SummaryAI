package com.kreativekoala.summaryai.domain.model

import androidx.annotation.StringRes
import com.kreativekoala.summaryai.R

/**
 * Meeting status
 */
enum class MeetingStatus {
    SCHEDULED,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED;

    @get:StringRes
    val labelRes: Int
        get() = when (this) {
            SCHEDULED -> R.string.status_scheduled
            IN_PROGRESS -> R.string.status_in_progress
            COMPLETED -> R.string.completed
            CANCELLED -> R.string.status_cancelled
        }
}

/**
 * Bot status for meeting recording
 */
enum class BotStatus {
    WAITING,
    JOINING,
    IN_CALL,
    RECORDING,
    DONE,
    ERROR;

    @get:StringRes
    val labelRes: Int
        get() = when (this) {
            WAITING -> R.string.status_waiting
            JOINING -> R.string.status_joining
            IN_CALL -> R.string.status_in_call
            RECORDING -> R.string.recording_fallback
            DONE -> R.string.status_done
            ERROR -> R.string.error
        }

    val isActive: Boolean
        get() = this in listOf(WAITING, JOINING, IN_CALL, RECORDING)
}

/**
 * Meeting domain model
 */
data class Meeting(
    val id: String,
    val title: String,
    val meetingUrl: String?,
    val platform: String?,
    val startTime: String?,
    val endTime: String?,
    val status: MeetingStatus,
    val botStatus: BotStatus?,
    val autoJoin: Boolean,
    val recordingId: String?,
    /** "auto" or a primary subtag; null when the backend does not report it. */
    val transcriptionLanguage: String? = null
) {
    val hasBot: Boolean
        get() = botStatus != null

    val isBotActive: Boolean
        get() = botStatus?.isActive == true

    val hasRecording: Boolean
        get() = recordingId != null

    /** Brand name of the platform (or the raw platform key for an unlisted one); null when the platform is not known. */
    val platformDisplayName: String?
        get() = when (platform?.lowercase()) {
            "zoom" -> "Zoom"
            "google_meet", "googlemeet" -> "Google Meet"
            "teams", "microsoft_teams" -> "Microsoft Teams"
            "webex" -> "Webex"
            else -> platform
        }
}

/**
 * Calendar connection
 */
data class CalendarConnection(
    val id: String,
    val provider: String,
    val providerEmail: String?,
    val syncEnabled: Boolean,
    val lastSyncedAt: String?
) {
    val providerDisplayName: String
        get() = when (provider.lowercase()) {
            "google" -> "Google Calendar"
            "microsoft" -> "Microsoft Outlook"
            else -> provider
        }

    val isGoogle: Boolean
        get() = provider.lowercase() == "google"

    val isMicrosoft: Boolean
        get() = provider.lowercase() == "microsoft"
}

/**
 * Live transcript segment during a meeting
 */
data class LiveTranscriptSegment(
    val id: String,
    val meetingId: String,
    val segmentText: String,
    val speakerId: String?,
    val speakerName: String?,
    val isHost: Boolean,
    val startTimestamp: Double,
    val endTimestamp: Double,
    val isPartial: Boolean,
    val createdAt: String
) {
    val displaySpeakerName: String
        get() = speakerName?.takeIf { it.isNotBlank() }
            ?: speakerId?.let { "Speaker $it" }
            ?: "Unknown"

    val formattedTimestamp: String
        get() {
            val mins = (startTimestamp / 60).toInt()
            val secs = (startTimestamp % 60).toInt()
            return String.format("%d:%02d", mins, secs)
        }
}
