package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.WeeklyStatsDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class StatsRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    suspend fun weekly(): Result<WeeklyStatsDto> = withContext(Dispatchers.IO) {
        runCatching { api.getWeeklyStats() }
    }
}
