package com.kreativekoala.summaryai.data.repository

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.coaching.CoachingApi
import com.kreativekoala.summaryai.data.api.coaching.CoachingClaimFreeResponse
import com.kreativekoala.summaryai.data.api.coaching.CoachingCredits
import com.kreativekoala.summaryai.data.api.coaching.CoachingEndResponse
import com.kreativekoala.summaryai.data.api.coaching.CoachingInsight
import com.kreativekoala.summaryai.data.api.coaching.CoachingPersonaKey
import com.kreativekoala.summaryai.data.api.coaching.CoachingStartSessionRequest
import com.kreativekoala.summaryai.data.api.coaching.CoachingStartSessionResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import javax.inject.Inject
import javax.inject.Singleton

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
) {
    private val gson: Gson = Gson()

    suspend fun claimFreeCredits(): CoachingClaimFreeResponse = api.claimFreeCredits()
    suspend fun getCredits(): CoachingCredits = api.getCredits()

    /** DEBUG only — grants 5 credits per call. */
    suspend fun debugGrantCredits() = api.debugGrantCredits()

    suspend fun startSession(recordingId: String, persona: CoachingPersonaKey): CoachingStartSessionResponse =
        api.startSession(CoachingStartSessionRequest(recordingId, persona.key))

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

    /**
     * Emits insights as they arrive on the SSE stream. Caller should collect on
     * a viewModelScope so cancellation closes the underlying connection.
     */
    fun streamInsights(sessionId: String): Flow<CoachingInsight> = flow {
        val url = "https://summary-ai-backend.fly.dev/api/coaching/sessions/$sessionId/stream"
        val body = api.streamInsights(url)
        body.byteStream().bufferedReader().use { reader ->
            var event: String? = null
            val data = StringBuilder()
            while (true) {
                val line = reader.readLine() ?: break
                when {
                    line.isEmpty() -> {
                        if (event == "insight" && data.isNotEmpty()) {
                            runCatching {
                                gson.fromJson(data.toString(), CoachingInsight::class.java)
                            }.getOrNull()?.let { emit(it) }
                        }
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
}
