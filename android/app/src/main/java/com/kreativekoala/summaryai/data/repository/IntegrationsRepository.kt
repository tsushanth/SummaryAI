package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.IntegrationDeliveryDto
import com.kreativekoala.summaryai.data.api.models.IntegrationDto
import com.kreativekoala.summaryai.data.api.models.IntegrationTestResponse
import com.kreativekoala.summaryai.data.api.models.IntegrationUpsertRequest
import com.kreativekoala.summaryai.data.api.models.MeetingAnalyticsDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Webhook / Slack / Notion integrations and per-meeting analytics.
 * Secrets are write-only: the server never returns them.
 */
@Singleton
class IntegrationsRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    suspend fun list(): Result<List<IntegrationDto>> = withContext(Dispatchers.IO) {
        runCatching { api.getIntegrations().integrations }
    }

    suspend fun deliveries(): Result<List<IntegrationDeliveryDto>> = withContext(Dispatchers.IO) {
        runCatching { api.getIntegrationDeliveries().deliveries }
    }

    suspend fun save(
        kind: String,
        url: String?,
        secret: String?,
        databaseId: String?
    ): Result<IntegrationDto> = withContext(Dispatchers.IO) {
        try {
            val body = IntegrationUpsertRequest(
                url = url?.trim()?.ifEmpty { null },
                secret = secret?.trim()?.ifEmpty { null },
                databaseId = databaseId?.trim()?.ifEmpty { null }
            )
            Result.success(api.saveIntegration(kind, body).integration)
        } catch (e: HttpException) {
            Result.failure(Exception(serverMessage(e) ?: "Could not save the integration."))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun delete(kind: String): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching { api.deleteIntegration(kind); Unit }
    }

    suspend fun test(kind: String): Result<IntegrationTestResponse> = withContext(Dispatchers.IO) {
        runCatching { api.testIntegration(kind) }
    }

    suspend fun analytics(recordingId: String): Result<MeetingAnalyticsDto> = withContext(Dispatchers.IO) {
        runCatching { api.getMeetingAnalytics(recordingId).analytics }
    }

    /** Extracts error.message from the backend's { error: { message } } envelope, if present. */
    private fun serverMessage(e: HttpException): String? = try {
        val raw = e.response()?.errorBody()?.string()
        if (raw.isNullOrBlank()) null else JSONObject(raw).optJSONObject("error")?.optString("message")?.ifBlank { null }
    } catch (_: Exception) {
        null
    }
}
