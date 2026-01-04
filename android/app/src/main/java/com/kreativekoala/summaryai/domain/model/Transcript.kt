package com.kreativekoala.summaryai.domain.model

/**
 * Transcript domain model
 */
data class Transcript(
    val id: String,
    val fullText: String,
    val segments: List<TranscriptSegment>,
    val language: String?,
    val wordCount: Int
)

/**
 * Individual segment of a transcript
 */
data class TranscriptSegment(
    val startTime: Double,
    val endTime: Double,
    val text: String,
    val speaker: String?
) {
    val formattedStartTime: String
        get() = formatTime(startTime)

    val formattedEndTime: String
        get() = formatTime(endTime)

    val formattedTimeRange: String
        get() = "$formattedStartTime - $formattedEndTime"

    private fun formatTime(seconds: Double): String {
        val totalSeconds = seconds.toInt()
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val secs = totalSeconds % 60

        return if (hours > 0) {
            String.format("%d:%02d:%02d", hours, minutes, secs)
        } else {
            String.format("%d:%02d", minutes, secs)
        }
    }
}
