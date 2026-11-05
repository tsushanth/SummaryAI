package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.MeetingLanguages
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.LiveTranscriptSegment
import com.kreativekoala.summaryai.domain.model.Meeting
import com.kreativekoala.summaryai.domain.model.MeetingStatus as DomainMeetingStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.google.gson.JsonParser
import retrofit2.HttpException
import retrofit2.Response
import javax.inject.Inject
import javax.inject.Singleton

/** Why the backend refused a live language change (HTTP 409). */
enum class LiveLanguageConflict {
    /** LIVE_LANGUAGE_FIXED: set when the bot joined, this transcript path cannot switch. */
    FIXED,
    /** MEETING_NOT_LIVE: no bot is in the meeting right now. */
    NOT_LIVE
}

/** Outcome of asking the backend to switch a live meeting's transcription language. */
sealed interface LiveLanguageResult {
    /** [liveApplied] false = saved (the final transcript uses it) but the live stream was not switched. */
    data class Success(val language: String, val liveApplied: Boolean = true) : LiveLanguageResult
    data class NotSwitchable(val conflict: LiveLanguageConflict) : LiveLanguageResult
    data class Failed(val message: String?) : LiveLanguageResult
}

/**
 * Builds the bot-join body. [language] is the already-decided request value (see
 * [MeetingLanguages.requestValue]): null leaves `transcription_language` out entirely, so the body is
 * identical to what older builds sent.
 */
internal fun buildJoinRequest(joinUrl: String, botName: String?, language: String?) = JoinMeetingRequest(
    joinUrl = joinUrl,
    botName = botName,
    transcriptionLanguage = language?.let { MeetingLanguages.normalize(it) }
)

/** Pure mapping of the live-language HTTP outcome so it can be unit tested without a network. */
internal fun mapLiveLanguageResponse(code: Int, body: String?, requested: String): LiveLanguageResult {
    val json = runCatching { JsonParser.parseString(body.orEmpty()).asJsonObject }.getOrNull()
    return when {
        code == 409 -> {
            val errorCode = runCatching { json?.getAsJsonObject("error")?.get("code")?.asString }.getOrNull()
            LiveLanguageResult.NotSwitchable(
                if (errorCode == "MEETING_NOT_LIVE") LiveLanguageConflict.NOT_LIVE else LiveLanguageConflict.FIXED
            )
        }
        code in 200..299 -> {
            val echoed = runCatching { json?.get("language")?.asString.orEmpty() }.getOrDefault("")
            val applied = runCatching { json?.get("live_applied")?.asBoolean }.getOrNull() ?: true
            LiveLanguageResult.Success(echoed.ifBlank { requested }, applied)
        }
        else -> LiveLanguageResult.Failed("HTTP $code")
    }
}

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
        botName: String? = null,
        transcriptionLanguage: String? = null
    ): Result<Pair<Meeting, String?>> = withContext(Dispatchers.IO) {
        try {
            val response = api.joinMeeting(buildJoinRequest(joinUrl, botName, transcriptionLanguage))
            // Get recording ID from top-level response or from nested meeting
            val recordingId = response.recordingId ?: response.meeting.recordingId
            Result.success(Pair(response.meeting.toDomain(), recordingId))
        } catch (e: HttpException) {
            // Over the monthly bot allowance: surface it as its own type so the screen can explain it.
            val capError = runCatching { parseBotCapError(e.code(), e.response()?.errorBody()?.string()) }.getOrNull()
            Result.failure(capError ?: e)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Update meeting (including auto_join toggle)
     */
    suspend fun updateMeeting(
        meetingId: String,
        autoJoin: Boolean? = null,
        transcriptionLanguage: String? = null
    ): Result<Meeting> = withContext(Dispatchers.IO) {
        try {
            val response = api.updateMeeting(
                id = meetingId,
                request = UpdateMeetingRequest(
                    autoJoin = autoJoin,
                    // "auto" is sent explicitly: it means "this meeting, auto", not "follow my default"
                    transcriptionLanguage = transcriptionLanguage?.let { MeetingLanguages.normalize(it) }
                )
            )
            Result.success(response.meeting.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Language fields of GET /api/meetings/:id (flat body). */
    suspend fun getMeetingLanguageState(meetingId: String): Result<MeetingDetailDto> = withContext(Dispatchers.IO) {
        try { Result.success(api.getMeetingDetail(meetingId)) }
        catch (e: Exception) { Result.failure(e) }
    }

    /**
     * Switch the language a live meeting is transcribed in ("auto" or a primary subtag).
     * A 409 comes back as [LiveLanguageResult.NotSwitchable], not an exception.
     */
    suspend fun setLiveLanguage(meetingId: String, language: String): LiveLanguageResult =
        withContext(Dispatchers.IO) {
            val value = MeetingLanguages.normalize(language)
            try {
                val response: Response<okhttp3.ResponseBody> =
                    api.setLiveLanguage(meetingId, LiveLanguageRequest(value))
                val text = (if (response.isSuccessful) response.body() else response.errorBody())?.string()
                mapLiveLanguageResponse(response.code(), text, value)
            } catch (e: Exception) {
                LiveLanguageResult.Failed(e.message)
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
    recordingId = recordingId,
    transcriptionLanguage = transcriptionLanguage
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
