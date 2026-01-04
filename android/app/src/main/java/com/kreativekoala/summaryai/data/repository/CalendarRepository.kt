package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.CalendarConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for calendar integration operations
 */
@Singleton
class CalendarRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    /**
     * Get all calendar connections
     */
    suspend fun getConnections(): Result<List<CalendarConnection>> = withContext(Dispatchers.IO) {
        try {
            val response = api.getCalendarConnections()
            Result.success(response.connections.map { it.toDomain() })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get OAuth URL for connecting a calendar
     */
    suspend fun getAuthUrl(
        provider: String,
        redirectUri: String = "summaryai://calendar/connected"
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.getCalendarAuthUrl(provider, redirectUri)
            Result.success(response.url)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Disconnect a calendar
     */
    suspend fun disconnect(provider: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            api.disconnectCalendar(provider)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Trigger calendar sync
     */
    suspend fun syncCalendar(): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            api.syncCalendar()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

// Extension functions
private fun CalendarConnectionDto.toDomain() = CalendarConnection(
    id = id,
    provider = provider,
    providerEmail = providerEmail,
    isActive = isActive,
    lastSyncAt = lastSyncAt
)
