package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// MARK: - Meeting Status
enum class MeetingStatus {
    @SerializedName("scheduled") SCHEDULED,
    @SerializedName("in_progress") IN_PROGRESS,
    @SerializedName("completed") COMPLETED,
    @SerializedName("cancelled") CANCELLED
}

// MARK: - Bot Status
enum class BotStatus {
    @SerializedName("waiting") WAITING,
    @SerializedName("joining") JOINING,
    @SerializedName("in_call") IN_CALL,
    @SerializedName("recording") RECORDING,
    @SerializedName("done") DONE,
    @SerializedName("error") ERROR
}

// MARK: - Meeting
data class MeetingDto(
    val id: String,
    @SerializedName("user_id") val userId: String,
    val title: String,
    @SerializedName("meeting_url") val meetingUrl: String?,
    @SerializedName("calendar_event_id") val calendarEventId: String?,
    val platform: String?,
    @SerializedName("start_time") val startTime: String,
    @SerializedName("end_time") val endTime: String?,
    val status: MeetingStatus,
    @SerializedName("bot_status") val botStatus: BotStatus?,
    @SerializedName("auto_join") val autoJoin: Boolean,
    @SerializedName("recording_id") val recordingId: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String
)

// MARK: - Calendar Connection
data class CalendarConnectionDto(
    val id: String,
    @SerializedName("user_id") val userId: String,
    val provider: String,
    @SerializedName("provider_email") val providerEmail: String?,
    @SerializedName("is_active") val isActive: Boolean,
    @SerializedName("last_sync_at") val lastSyncAt: String?,
    @SerializedName("created_at") val createdAt: String
)

// MARK: - API Requests

data class JoinMeetingRequest(
    @SerializedName("meeting_url") val meetingUrl: String,
    val title: String? = null
)

data class ScheduleMeetingBotRequest(
    @SerializedName("meeting_id") val meetingId: String,
    @SerializedName("auto_join") val autoJoin: Boolean = true
)

// MARK: - API Responses

data class ListMeetingsResponse(
    val meetings: List<MeetingDto>,
    val pagination: PaginationDto
)

data class MeetingResponse(
    val meeting: MeetingDto
)

data class JoinMeetingResponse(
    val meeting: MeetingDto,
    @SerializedName("bot_id") val botId: String?
)

data class CalendarConnectionsResponse(
    val connections: List<CalendarConnectionDto>
)

data class CalendarAuthUrlResponse(
    val url: String
)
