package com.kreativekoala.summaryai.ui.coaching

import com.google.gson.JsonParser
import com.kreativekoala.summaryai.data.api.coaching.CoachingInsight
import com.kreativekoala.summaryai.data.api.coaching.CoachingLatestSessionResponse
import com.kreativekoala.summaryai.data.api.coaching.CoachingPersonaKey
import com.kreativekoala.summaryai.data.repository.CoachingRepository
import com.kreativekoala.summaryai.data.repository.CoachingStreamEvent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

enum class CoachingPhase { IDLE, STARTING, LIVE, RECONNECTING, ENDED, NOT_STARTED }

enum class CoachingStartFailure { NO_CREDITS, MEETING_OVER, OTHER }

data class CoachingState(
    val meetingId: String? = null,
    val phase: CoachingPhase = CoachingPhase.IDLE,
    /** Newest first, each tip once. */
    val insights: List<CoachingInsight> = emptyList(),
    /** Server code for why the session ended (or why the bot is gone when it could not start). Null = unknown. */
    val endReason: String? = null,
    val refunded: Boolean = false,
    val startFailure: CoachingStartFailure? = null,
)

/**
 * App-wide store for the AI Coach session. It lives as long as the app does, not as long as any screen: only the user
 * ([stop]) or the server (the meeting ended, the bot failed or was not let in) ends a session. Leaving a screen,
 * switching tabs or losing the connection does not.
 */
@Singleton
class ActiveCoachingSession internal constructor(
    private val repository: CoachingRepository,
    private val scope: CoroutineScope,
) {
    @Inject constructor(repository: CoachingRepository) :
        this(repository, CoroutineScope(SupervisorJob() + Dispatchers.Default))

    private val _state = MutableStateFlow(CoachingState())
    val state: StateFlow<CoachingState> = _state.asStateFlow()

    private var job: Job? = null
    private var sessionId: String? = null
    private var request: Triple<String, String, CoachingPersonaKey>? = null

    /** Starts coaching for a meeting. Safe to call from a screen that is about to close. */
    @Synchronized
    fun start(meetingId: String, recordingId: String, persona: CoachingPersonaKey) {
        job?.cancel()
        sessionId = null
        request = Triple(meetingId, recordingId, persona)
        _state.value = CoachingState(meetingId, CoachingPhase.STARTING)
        job = scope.launch {
            val id = startSession(meetingId, recordingId, persona) ?: return@launch
            sessionId = id
            follow(meetingId, recordingId, id)
        }
    }

    /** Repeats a start that failed. The server returns the open session if the first request did reach it. */
    fun retry() {
        val (meetingId, recordingId, persona) = request ?: return
        if (_state.value.phase == CoachingPhase.NOT_STARTED) start(meetingId, recordingId, persona)
    }

    /**
     * Picks up the session of a meeting being looked at when this app does not know about it (it was restarted, or the
     * user opened an earlier meeting). Best effort.
     */
    fun attach(meetingId: String, recordingId: String) {
        if (knows(meetingId)) return
        scope.launch {
            val latest = latest(recordingId) ?: return@launch
            val session = latest.session ?: return@launch
            synchronized(this@ActiveCoachingSession) {
                if (knows(meetingId)) return@synchronized
                // Looking at an earlier meeting must not interrupt a session that is running for another one.
                if (session.endedAt != null && _state.value.phase in RUNNING) return@synchronized
                job?.cancel()
                sessionId = session.id
                request = null
                _state.value = CoachingState(meetingId, CoachingPhase.RECONNECTING, newestFirst(latest.insights.orEmpty()))
                if (session.endedAt != null) {
                    ended(meetingId, session.endReason, session.refunded == true)
                } else {
                    job = scope.launch { follow(meetingId, recordingId, session.id) }
                }
            }
        }
    }

    /** The user's own stop. */
    @Synchronized
    fun stop() {
        val id = sessionId ?: return
        val meetingId = _state.value.meetingId ?: return
        job?.cancel()
        ended(meetingId, REASON_STOPPED, refunded = false)
        scope.launch {
            val response = runCatching { repository.endSession(id) }.getOrNull() ?: return@launch
            update(meetingId) { it.copy(refunded = response.refunded) }
        }
    }

    private fun knows(meetingId: String): Boolean =
        _state.value.let { it.meetingId == meetingId && it.phase != CoachingPhase.IDLE }

    private suspend fun startSession(meetingId: String, recordingId: String, persona: CoachingPersonaKey): String? {
        var attempt = 0
        while (true) {
            try {
                return repository.startSession(recordingId, persona).sessionId
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val status = (e as? HttpException)?.code()
                // A repeat is safe: the server hands back the open session instead of taking a second credit.
                val transient = e is IOException || (status != null && status >= 500)
                if (transient && attempt < START_RETRY_MS.size) {
                    delay(START_RETRY_MS[attempt++])
                    continue
                }
                val failure = when (status) {
                    402 -> CoachingStartFailure.NO_CREDITS
                    409 -> CoachingStartFailure.MEETING_OVER
                    else -> CoachingStartFailure.OTHER
                }
                val reason = if (failure == CoachingStartFailure.MEETING_OVER) endReasonOf(e as HttpException) else null
                update(meetingId) { it.copy(phase = CoachingPhase.NOT_STARTED, startFailure = failure, endReason = reason) }
                return null
            }
        }
    }

    /** Reads the live tips until the session ends, reconnecting whenever the connection drops. */
    private suspend fun follow(meetingId: String, recordingId: String, id: String) {
        var attempt = 0
        while (true) {
            var over = false
            var refused = false
            try {
                repository.streamEvents(id).collect { event ->
                    when (event) {
                        CoachingStreamEvent.Connected -> {
                            attempt = 0
                            update(meetingId) { it.copy(phase = CoachingPhase.LIVE) }
                        }
                        is CoachingStreamEvent.Tip -> update(meetingId) { s ->
                            if (s.insights.any { it.id == event.insight.id }) s
                            else s.copy(insights = listOf(event.insight) + s.insights)
                        }
                        is CoachingStreamEvent.Ended -> {
                            over = true
                            ended(meetingId, event.reason, event.refunded)
                        }
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // 400: already ended. 404: gone. Anything else is the connection.
                refused = (e as? HttpException)?.code().let { it == 400 || it == 404 }
            }
            if (over) return
            val latest = latest(recordingId)
            val session = latest?.session?.takeIf { it.id == id }
            if (latest != null && session != null) {
                // Tips given while we were not listening.
                update(meetingId) { s -> s.copy(insights = newestFirst(s.insights + latest.insights.orEmpty())) }
            }
            if (refused || session?.endedAt != null) {
                ended(meetingId, session?.endReason, session?.refunded == true)
                return
            }
            update(meetingId) { it.copy(phase = CoachingPhase.RECONNECTING) }
            delay(RECONNECT_MS[minOf(attempt++, RECONNECT_MS.lastIndex)])
        }
    }

    private suspend fun latest(recordingId: String): CoachingLatestSessionResponse? = try {
        repository.getLatestSession(recordingId)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    private fun ended(meetingId: String, reason: String?, refunded: Boolean) =
        update(meetingId) { it.copy(phase = CoachingPhase.ENDED, endReason = reason, refunded = refunded) }

    private fun update(meetingId: String, change: (CoachingState) -> CoachingState) =
        _state.update { if (it.meetingId == meetingId) change(it) else it }

    private fun newestFirst(tips: List<CoachingInsight>): List<CoachingInsight> =
        tips.distinctBy { it.id }.sortedByDescending { it.emittedAt }

    private fun endReasonOf(e: HttpException): String? = runCatching {
        JsonParser.parseString(e.response()?.errorBody()?.string()).asJsonObject.get("end_reason").asString
    }.getOrNull()

    companion object {
        const val REASON_STOPPED = "client"
        private val RUNNING = setOf(CoachingPhase.STARTING, CoachingPhase.LIVE, CoachingPhase.RECONNECTING)
        private val START_RETRY_MS = longArrayOf(2_000, 5_000)
        private val RECONNECT_MS = longArrayOf(2_000, 5_000, 10_000, 20_000, 30_000)
    }
}
