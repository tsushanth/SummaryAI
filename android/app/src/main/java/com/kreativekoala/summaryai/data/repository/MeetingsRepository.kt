package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.Meeting
import com.kreativekoala.summaryai.domain.model.MeetingStatus as DomainMeetingStatus
import com.kreativekoala.summaryai.domain.model.BotStatus as DomainBotStatus
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
        page: Int = 1,
        perPage: Int = 20,
        status: DomainMeetingStatus? = null,
        upcoming: Boolean? = null
    ): Result<List<Meeting>> = withContext(Dispatchers.IO) {
        try {
            val response = api.getMeetings(
                page = page,
                perPage = perPage,
                status = status?.name?.lowercase(),
                upcoming = upcoming
            )
            Result.success(response.meetings.map { it.toDomain() })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get upcoming meetings
     */
    suspend fun getUpcomingMeetings(): Result<List<Meeting>> {
        return getMeetings(upcoming = true)
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
     */
    suspend fun joinMeeting(
        meetingUrl: String,
        title: String? = null
    ): Result<Meeting> = withContext(Dispatchers.IO) {
        try {
            val response = api.joinMeeting(
                JoinMeetingRequest(
                    meetingUrl = meetingUrl,
                    title = title
                )
            )
            Result.success(response.meeting.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Schedule bot to join a meeting
     */
    suspend fun scheduleMeetingBot(
        meetingId: String,
        autoJoin: Boolean = true
    ): Result<Meeting> = withContext(Dispatchers.IO) {
        try {
            val response = api.scheduleMeetingBot(
                id = meetingId,
                request = ScheduleMeetingBotRequest(
                    meetingId = meetingId,
                    autoJoin = autoJoin
                )
            )
            Result.success(response.meeting.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Cancel bot for a meeting
     */
    suspend fun cancelMeetingBot(meetingId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            api.cancelMeetingBot(meetingId)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

// Extension functions
private fun MeetingDto.toDomain() = Meeting(
    id = id,
    title = title,
    meetingUrl = meetingUrl,
    platform = platform,
    startTime = startTime,
    endTime = endTime,
    status = status.toDomain(),
    botStatus = botStatus?.toDomain(),
    autoJoin = autoJoin,
    recordingId = recordingId
)

private fun MeetingStatus.toDomain(): DomainMeetingStatus = when (this) {
    MeetingStatus.SCHEDULED -> DomainMeetingStatus.SCHEDULED
    MeetingStatus.IN_PROGRESS -> DomainMeetingStatus.IN_PROGRESS
    MeetingStatus.COMPLETED -> DomainMeetingStatus.COMPLETED
    MeetingStatus.CANCELLED -> DomainMeetingStatus.CANCELLED
}

private fun BotStatus.toDomain(): DomainBotStatus = when (this) {
    BotStatus.WAITING -> DomainBotStatus.WAITING
    BotStatus.JOINING -> DomainBotStatus.JOINING
    BotStatus.IN_CALL -> DomainBotStatus.IN_CALL
    BotStatus.RECORDING -> DomainBotStatus.RECORDING
    BotStatus.DONE -> DomainBotStatus.DONE
    BotStatus.ERROR -> DomainBotStatus.ERROR
}
