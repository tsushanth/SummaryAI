package com.kreativekoala.summaryai.data.preferences

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Tracks the number of times the app has been opened (cold starts).
 * Uses SharedPreferences for simple, synchronous access.
 */
@Singleton
class AppOpenTracker @Inject constructor(
    @ApplicationContext context: Context
) {
    companion object {
        private const val PREFS_NAME = "app_open_tracker"
        private const val KEY_OPEN_COUNT = "open_count"
        const val FREE_OPEN_LIMIT = 3
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Increments the app open count by 1 and returns the new count.
     * Should be called once per app session (cold start only).
     */
    fun incrementAndGetCount(): Int {
        val current = prefs.getInt(KEY_OPEN_COUNT, 0)
        val newCount = current + 1
        prefs.edit().putInt(KEY_OPEN_COUNT, newCount).apply()
        return newCount
    }

    /**
     * Returns the current open count without incrementing.
     */
    fun getCount(): Int = prefs.getInt(KEY_OPEN_COUNT, 0)

    /**
     * Returns true if the user has exceeded the free open limit.
     */
    fun hasExceededFreeLimit(): Boolean = getCount() > FREE_OPEN_LIMIT
}
