package com.kreativekoala.summaryai.domain.model

/**
 * Meeting status
 */
enum class MeetingStatus {
    SCHEDULED,
    IN_PROGRESS,
    COMPLETED,
    CANCELLED;

    val displayName: String
        get() = when (this) {
            SCHEDULED -> "Scheduled"
            IN_PROGRESS -> "In Progress"
            COMPLETED -> "Completed"
            CANCELLED -> "Cancelled"
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

    val displayName: String
        get() = when (this) {
            WAITING -> "Waiting"
            JOINING -> "Joining"
            IN_CALL -> "In Call"
            RECORDING -> "Recording"
            DONE -> "Done"
            ERROR -> "Error"
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
    val startTime: String,
    val endTime: String?,
    val status: MeetingStatus,
    val botStatus: BotStatus?,
    val autoJoin: Boolean,
    val recordingId: String?
) {
    val hasBot: Boolean
        get() = botStatus != null

    val isBotActive: Boolean
        get() = botStatus?.isActive == true

    val hasRecording: Boolean
        get() = recordingId != null

    val platformDisplayName: String
        get() = when (platform?.lowercase()) {
            "zoom" -> "Zoom"
            "google_meet", "googlemeet" -> "Google Meet"
            "teams", "microsoft_teams" -> "Microsoft Teams"
            "webex" -> "Webex"
            else -> platform ?: "Unknown"
        }
}

/**
 * Calendar connection
 */
data class CalendarConnection(
    val id: String,
    val provider: String,
    val providerEmail: String?,
    val isActive: Boolean,
    val lastSyncAt: String?
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
