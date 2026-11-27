package com.kreativekoala.summaryai.data.repository

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.kreativekoala.summaryai.BuildConfig
import com.kreativekoala.summaryai.data.api.coaching.CoachingApi
import com.kreativekoala.summaryai.data.api.coaching.CoachingClaimFreeResponse
import com.kreativekoala.summaryai.data.api.coaching.CoachingCredits
import com.kreativekoala.summaryai.data.api.coaching.CoachingEndResponse
import com.kreativekoala.summaryai.data.api.coaching.CoachingInsight
import com.kreativekoala.summaryai.data.api.coaching.CoachingPersonaKey
import com.kreativekoala.summaryai.data.api.coaching.CoachingStartSessionRequest
import com.kreativekoala.summaryai.data.api.coaching.CoachingStartSessionResponse
import com.kreativekoala.summaryai.util.OutputLanguageSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import javax.inject.Inject
import javax.inject.Singleton

/** What the live tips stream says. [Ended] is the server's last word on a session. */
sealed interface CoachingStreamEvent {
    data object Connected : CoachingStreamEvent
    data class Tip(val insight: CoachingInsight) : CoachingStreamEvent
    data class Ended(val reason: String?, val refunded: Boolean) : CoachingStreamEvent
}

private data class EndedFrame(
    @SerializedName("reason") val reason: String?,
    @SerializedName("refunded") val refunded: Boolean,
)

/**
 * Wraps CoachingApi with a coroutine-friendly Flow for the SSE insight stream.
 * SSE frames look like:
 *   event: insight
 *   data: { ...json... }
 *   <blank>
 */
@Singleton
class CoachingRepository @Inject constructor(
    private val api: CoachingApi,
    private val outputLanguage: OutputLanguageSource,
) {
    private val gson: Gson = Gson()

    suspend fun claimFreeCredits(): CoachingClaimFreeResponse = api.claimFreeCredits()
    suspend fun getCredits(): CoachingCredits = api.getCredits()

    suspend fun startSession(recordingId: String, persona: CoachingPersonaKey): CoachingStartSessionResponse =
        api.startSession(CoachingStartSessionRequest(recordingId, persona.key, outputLanguage.current()))

    suspend fun endSession(sessionId: String): CoachingEndResponse = api.endSession(sessionId)

    suspend fun verifyGooglePlayPurchase(productId: String, purchaseToken: String) =
        api.verifyGooglePlayPurchase(
            com.kreativekoala.summaryai.data.api.coaching.CoachingGooglePlayVerifyRequest(
                purchaseToken = purchaseToken,
                productId = productId,
            )
        )

    suspend fun getInsights(sessionId: String): List<CoachingInsight> =
        api.getInsights(sessionId).insights

    /** The latest session on a recording with its tips; `session` is null when there never was one. */
    suspend fun getLatestSession(recordingId: String) = api.getLatestSession(recordingId)

    /**
     * Emits [CoachingStreamEvent.Connected] once the stream is open, then tips as they arrive. Completes when the
     * connection closes, with or without an [CoachingStreamEvent.Ended] before it.
     */
    fun streamEvents(sessionId: String): Flow<CoachingStreamEvent> = flow {
        val url = "${BuildConfig.API_BASE_URL}/api/coaching/sessions/$sessionId/stream"
        val body = api.streamInsights(url)
        body.byteStream().bufferedReader().use { reader ->
            emit(CoachingStreamEvent.Connected)
            var event: String? = null
            val data = StringBuilder()
            while (true) {
                val line = reader.readLine() ?: break
                // The server's heartbeat gets a cancelled reader out of the blocking read.
                currentCoroutineContext().ensureActive()
                when {
                    line.isEmpty() -> {
                        parseFrame(event, data.toString())?.let { emit(it) }
                        event = null
                        data.clear()
                    }
                    line.startsWith(": ") -> { /* heartbeat */ }
                    line.startsWith("event:") -> event = line.substring(6).trim()
                    line.startsWith("data:") -> {
                        val chunk = line.substring(5).trim()
                        if (data.isEmpty()) data.append(chunk) else data.append('\n').append(chunk)
                    }
                }
            }
        }
    }.flowOn(Dispatchers.IO)

    private fun parseFrame(event: String?, data: String): CoachingStreamEvent? {
        if (data.isEmpty()) return null
        return runCatching {
            when (event) {
                "insight" -> CoachingStreamEvent.Tip(gson.fromJson(data, CoachingInsight::class.java))
                "ended" -> gson.fromJson(data, EndedFrame::class.java).let { CoachingStreamEvent.Ended(it.reason, it.refunded) }
                else -> null
            }
        }.getOrNull()
    }
}
