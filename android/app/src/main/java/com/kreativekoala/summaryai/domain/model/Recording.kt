package com.kreativekoala.summaryai.domain.model

/**
 * Recording status
 */
enum class RecordingStatus {
    PENDING,
    UPLOADING,
    UPLOADED,
    PROCESSING,
    TRANSCRIBING,
    SUMMARIZING,
    COMPLETED,
    FAILED;

    val isProcessing: Boolean
        get() = this in listOf(PENDING, UPLOADING, UPLOADED, PROCESSING, TRANSCRIBING, SUMMARIZING)

    val displayName: String
        get() = when (this) {
            PENDING -> "Pending"
            UPLOADING -> "Uploading"
            UPLOADED -> "Uploaded"
            PROCESSING -> "Processing"
            TRANSCRIBING -> "Transcribing"
            SUMMARIZING -> "Summarizing"
            COMPLETED -> "Completed"
            FAILED -> "Failed"
        }
}

/**
 * Recording domain model
 */
data class Recording(
    val id: String,
    val title: String,
    val durationSeconds: Int,
    val status: RecordingStatus,
    val audioUrl: String?,
    val createdAt: String
) {
    val formattedDuration: String
        get() {
            val hours = durationSeconds / 3600
            val minutes = (durationSeconds % 3600) / 60
            val seconds = durationSeconds % 60

            return if (hours > 0) {
                String.format("%d:%02d:%02d", hours, minutes, seconds)
            } else {
                String.format("%d:%02d", minutes, seconds)
            }
        }

    val isProcessing: Boolean
        get() = status.isProcessing
}

/**
 * Recording with full details including transcript and summary
 */
data class RecordingDetail(
    val recording: Recording,
    val transcript: Transcript?,
    val summary: Summary?
)
