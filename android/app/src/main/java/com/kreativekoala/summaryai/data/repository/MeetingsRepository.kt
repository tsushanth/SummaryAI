package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.LiveTranscriptSegment
import com.kreativekoala.summaryai.domain.model.Meeting
import com.kreativekoala.summaryai.domain.model.MeetingStatus as DomainMeetingStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for meeting-related operations
 */
@Singleton
class MeetingsRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    /**
     * Get meetings list
     */
    suspend fun getMeetings(
        limit: Int = 50,
        offset: Int = 0,
        status: String? = null,
        daysAhead: Int? = null
    ): Result<List<Meeting>> = withContext(Dispatchers.IO) {
        try {
            val response = api.getMeetings(
                limit = limit,
                offset = offset,
                status = status,
                daysAhead = daysAhead
            )
            Result.success(response.items.map { it.toDomain() })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get upcoming meetings
     */
    suspend fun getUpcomingMeetings(): Result<List<Meeting>> {
        return getMeetings(status = "upcoming", daysAhead = 14)
    }

    /**
     * Get a single meeting
     */
    suspend fun getMeeting(id: String): Result<Meeting> = withContext(Dispatchers.IO) {
        try {
            val response = api.getMeeting(id)
            Result.success(response.meeting.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Join a meeting with bot
     * Returns a Pair of (Meeting, recordingId)
     */
    suspend fun joinMeeting(
        joinUrl: String,
        botName: String? = null
    ): Result<Pair<Meeting, String?>> = withContext(Dispatchers.IO) {
        try {
            val response = api.joinMeeting(
                JoinMeetingRequest(
                    joinUrl = joinUrl,
                    botName = botName
                )
            )
            // Get recording ID from top-level response or from nested meeting
            val recordingId = response.recordingId ?: response.meeting.recordingId
            Result.success(Pair(response.meeting.toDomain(), recordingId))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Update meeting (including auto_join toggle)
     */
    suspend fun updateMeeting(
        meetingId: String,
        autoJoin: Boolean? = null
    ): Result<Meeting> = withContext(Dispatchers.IO) {
        try {
            val response = api.updateMeeting(
                id = meetingId,
                request = UpdateMeetingRequest(autoJoin = autoJoin)
            )
            Result.success(response.meeting.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get live transcript segments for a meeting
     */
    suspend fun getLiveTranscript(
        meetingId: String,
        since: String? = null
    ): Result<Pair<List<LiveTranscriptSegment>, Boolean>> = withContext(Dispatchers.IO) {
        try {
            val response = api.getLiveTranscript(meetingId, since)
            Result.success(Pair(response.segments.map { it.toDomain() }, response.hasMore))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Stitched view of the realtime transcript so far — works mid-meeting and
     * before post-processing finishes. Used by the share sheet so users can
     * export what's been said even when the full transcript isn't ready.
     */
    suspend fun getStitchedLiveTranscript(
        meetingId: String
    ): Result<com.kreativekoala.summaryai.data.api.models.StitchedLiveTranscriptResponse> = withContext(Dispatchers.IO) {
        try { Result.success(api.getStitchedLiveTranscript(meetingId)) }
        catch (e: Exception) { Result.failure(e) }
    }
}

// Extension functions
private fun MeetingDto.toDomain() = Meeting(
    id = id,
    title = title ?: "Meeting",
    meetingUrl = joinUrl,
    platform = platform,
    startTime = scheduledStart,
    endTime = scheduledEnd,
    status = status.toDomainStatus(),
    botStatus = null, // Not returned in list endpoint
    autoJoin = autoJoin ?: false,
    recordingId = recordingId
)

private fun String.toDomainStatus(): DomainMeetingStatus = when (this.lowercase()) {
    "scheduled" -> DomainMeetingStatus.SCHEDULED
    "bot_queued" -> DomainMeetingStatus.SCHEDULED
    "bot_joining" -> DomainMeetingStatus.IN_PROGRESS
    "bot_in_meeting" -> DomainMeetingStatus.IN_PROGRESS
    "in_progress" -> DomainMeetingStatus.IN_PROGRESS
    "completed" -> DomainMeetingStatus.COMPLETED
    "cancelled", "canceled" -> DomainMeetingStatus.CANCELLED
    "failed" -> DomainMeetingStatus.CANCELLED
    else -> DomainMeetingStatus.SCHEDULED
}

private fun LiveTranscriptSegmentDto.toDomain() = LiveTranscriptSegment(
    id = id,
    meetingId = meetingId,
    segmentText = segmentText,
    speakerId = speakerId,
    speakerName = speakerName,
    isHost = isHost,
    startTimestamp = startTimestamp,
    endTimestamp = endTimestamp,
    isPartial = isPartial,
    createdAt = createdAt
)
