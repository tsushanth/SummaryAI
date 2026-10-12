package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.ActionItemsToTodosResponse
import com.kreativekoala.summaryai.data.api.models.CrossMeetingChatRequest
import com.kreativekoala.summaryai.data.api.models.CrossMeetingChatResponse
import com.kreativekoala.summaryai.data.api.models.FollowUpEmailRequest
import com.kreativekoala.summaryai.data.api.models.FollowUpEmailResponse
import com.kreativekoala.summaryai.data.api.models.RegenerateSummaryRequest
import com.kreativekoala.summaryai.data.api.models.SetDefaultTemplateRequest
import com.kreativekoala.summaryai.data.api.models.SummaryTemplatesResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/** Summary templates, regenerate, follow-up email, action-items-to-todos and cross-meeting chat. */
@Singleton
class IntelligenceRepository @Inject constructor(
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

    suspend fun getTemplates(): Result<SummaryTemplatesResponse> = io { api.getSummaryTemplates() }

    suspend fun setDefaultTemplate(template: String): Result<String?> =
        io { api.setDefaultSummaryTemplate(SetDefaultTemplateRequest(template)).defaultTemplate }

    suspend fun regenerateSummary(recordingId: String, template: String): Result<String?> =
        io { api.regenerateSummary(recordingId, RegenerateSummaryRequest(template)).template }

    suspend fun followUpEmail(recordingId: String): Result<FollowUpEmailResponse> =
        io { api.followUpEmail(recordingId, FollowUpEmailRequest()) }

    suspend fun actionItemsToTodos(recordingId: String): Result<ActionItemsToTodosResponse> =
        io { api.actionItemsToTodos(recordingId) }

    suspend fun chat(question: String): Result<CrossMeetingChatResponse> =
        io { api.chatAcrossMeetings(CrossMeetingChatRequest(question = question)) }
}
