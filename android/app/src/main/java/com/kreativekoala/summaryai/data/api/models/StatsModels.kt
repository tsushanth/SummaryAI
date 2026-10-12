package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

/** GET /api/stats/weekly: totals for the last 7 days. */
data class WeeklyStatsDto(
    val meetings: Int = 0,
    @SerializedName("hours_recorded") val hoursRecorded: Double = 0.0,
    @SerializedName("action_items") val actionItems: Int = 0
)
