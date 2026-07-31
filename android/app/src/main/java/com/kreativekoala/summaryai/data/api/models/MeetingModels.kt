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
    val title: String? = null,
    val platform: String? = null,
    val source: String? = null,
    @SerializedName("scheduled_start") val scheduledStart: String? = null,
    @SerializedName("scheduled_end") val scheduledEnd: String? = null,
    @SerializedName("auto_join") val autoJoin: Boolean? = null,
    val status: String,
    @SerializedName("recording_id") val recordingId: String? = null,
    @SerializedName("join_url") val joinUrl: String? = null
)

// MARK: - Calendar Connection
data class CalendarConnectionDto(
    val id: String,
    val provider: String,
    @SerializedName("provider_email") val providerEmail: String?,
    @SerializedName("sync_enabled") val syncEnabled: Boolean,
    @SerializedName("last_synced_at") val lastSyncedAt: String?,
    @SerializedName("created_at") val createdAt: String
)

// MARK: - API Requests

data class JoinMeetingRequest(
    @SerializedName("join_url") val joinUrl: String,
    @SerializedName("bot_name") val botName: String? = null
)

data class ScheduleMeetingBotRequest(
    @SerializedName("meeting_id") val meetingId: String,
    @SerializedName("auto_join") val autoJoin: Boolean = true
)

data class UpdateMeetingRequest(
    @SerializedName("auto_join") val autoJoin: Boolean? = null,
    val title: String? = null
)

// MARK: - API Responses

data class ListMeetingsResponse(
    val items: List<MeetingDto>,
    val total: Int
)

data class MeetingResponse(
    val meeting: MeetingDto
)

data class JoinMeetingResponse(
    val meeting: MeetingDto,
    @SerializedName("bot_id") val botId: String?,
    @SerializedName("recording_id") val recordingId: String?
)

data class CalendarConnectionsResponse(
    val connections: List<CalendarConnectionDto>
)

data class CalendarAuthUrlResponse(
    @SerializedName("auth_url") val url: String
)

// MARK: - Live Transcript

data class LiveTranscriptSegmentDto(
    val id: String,
    @SerializedName("meeting_id") val meetingId: String,
    @SerializedName("segment_text") val segmentText: String,
    @SerializedName("speaker_id") val speakerId: String?,
    @SerializedName("speaker_name") val speakerName: String?,
    @SerializedName("is_host") val isHost: Boolean,
    @SerializedName("start_timestamp") val startTimestamp: Double,
    @SerializedName("end_timestamp") val endTimestamp: Double,
    @SerializedName("is_partial") val isPartial: Boolean,
    @SerializedName("created_at") val createdAt: String
)

data class LiveTranscriptResponse(
    val segments: List<LiveTranscriptSegmentDto>,
    @SerializedName("has_more") val hasMore: Boolean
)

data class StitchedTranscriptSegmentDto(
    val id: String,
    @SerializedName("speaker_label") val speakerLabel: String,
    @SerializedName("speaker_index") val speakerIndex: Int,
    val text: String,
    @SerializedName("start_time") val startTime: Double,
    @SerializedName("end_time") val endTime: Double,
    val confidence: Double
)

data class StitchedLiveTranscriptResponse(
    @SerializedName("full_text") val fullText: String,
    val segments: List<StitchedTranscriptSegmentDto>,
    @SerializedName("word_count") val wordCount: Int,
    @SerializedName("speaker_count") val speakerCount: Int,
    @SerializedName("duration_seconds") val durationSeconds: Int,
    val source: String
)
