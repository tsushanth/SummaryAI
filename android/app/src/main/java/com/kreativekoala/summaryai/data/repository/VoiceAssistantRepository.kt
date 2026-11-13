package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.VoiceAssistantRequest
import com.kreativekoala.summaryai.data.api.models.VoiceAssistantResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What the switch should show. The user's own saved choice wins; when they never chose, it follows the
 * server's answer (for rollout mode "all" that is on). A server-wide kill / rollout "off" is not shown as a
 * user opt-out: with no saved choice the switch just reads off.
 */
internal fun VoiceAssistantResponse.switchOn(): Boolean =
    preference ?: (mode == "all" || enabled == true)

/** The in-meeting voice assistant on/off preference (docs/VOICE_ASSISTANT.md). Authenticated by the normal API client. */
@Singleton
class VoiceAssistantRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    private suspend fun <T> io(block: suspend () -> T): Result<T> = withContext(Dispatchers.IO) {
        try {
            Result.success(block())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Whether the switch is on for this user. Failure (offline, 401, 5xx) comes back as a failed Result, never a throw. */
    suspend fun load(): Result<Boolean> = io { api.getVoiceAssistant().switchOn() }

    /** Saves the choice; on success returns the value the server stored. */
    suspend fun save(enabled: Boolean): Result<Boolean> =
        io { api.setVoiceAssistant(VoiceAssistantRequest(enabled)).preference ?: enabled }
}
