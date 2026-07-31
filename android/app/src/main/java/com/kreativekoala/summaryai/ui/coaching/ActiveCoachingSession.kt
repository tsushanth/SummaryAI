package com.kreativekoala.summaryai.ui.coaching

import com.kreativekoala.summaryai.data.api.coaching.CoachingInsight
import com.kreativekoala.summaryai.data.repository.CoachingRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * App-wide store for the currently-running coaching session. Mirrors iOS
 * `ActiveCoachingSession`. Lets the JoinMeeting screen start a session when
 * the bot joins and the LiveTranscript screen render the panel from a shared
 * Flow without threading the sessionId through navigation.
 */
@Singleton
class ActiveCoachingSession @Inject constructor(
    private val coachingRepository: CoachingRepository,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private val _insights = MutableStateFlow<List<CoachingInsight>>(emptyList())
    val insights: StateFlow<List<CoachingInsight>> = _insights.asStateFlow()

    private val _isActive = MutableStateFlow(false)
    val isActive: StateFlow<Boolean> = _isActive.asStateFlow()

    private val sessionByMeeting = mutableMapOf<String, String>()
    private var streamJob: Job? = null
    private var activeMeetingId: String? = null

    fun sessionId(meetingId: String?): String? =
        meetingId?.let { sessionByMeeting[it] }

    fun start(meetingId: String, sessionId: String) {
        sessionByMeeting[meetingId] = sessionId
        activeMeetingId = meetingId
        _insights.value = emptyList()
        _isActive.value = true
        streamJob?.cancel()
        streamJob = scope.launch {
            coachingRepository.streamInsights(sessionId)
                .catch { _isActive.value = false }
                .collect { insight ->
                    _insights.value = listOf(insight) + _insights.value
                }
            _isActive.value = false
        }
    }

    fun endActive() {
        streamJob?.cancel()
        val mid = activeMeetingId
        val sid = mid?.let { sessionByMeeting[it] }
        if (mid != null) sessionByMeeting.remove(mid)
        activeMeetingId = null
        _isActive.value = false
        // Fire-and-forget the end call so the backend auto-refunds if light.
        if (sid != null) {
            scope.launch { runCatching { coachingRepository.endSession(sid) } }
        }
        _insights.value = emptyList()
    }
}
