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
        get() = this != COMPLETED && this != FAILED

    val displayName: String
        get() = when (this) {
            PENDING -> "Bot joining..."
            UPLOADING -> "Recording..."
            UPLOADED -> "Processing..."
            PROCESSING -> "Processing..."
            TRANSCRIBING -> "Transcribing..."
            SUMMARIZING -> "Summarizing..."
            COMPLETED -> "Ready"
            FAILED -> "Failed"
        }
}

/**
 * Recording type
 */
enum class RecordingType {
    GENERAL,
    MEETING,
    LECTURE,
    INTERVIEW,
    VOICE_MEMO,
    IMPORTED
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
    val createdAt: String,
    val isFavorite: Boolean = false,
    val recordingType: RecordingType? = null,
    val meetingId: String? = null
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

    val isLiveMeeting: Boolean
        get() = meetingId != null && (status == RecordingStatus.PENDING || status == RecordingStatus.UPLOADING)
}

/**
 * Recording with full details including transcript and summary
 */
data class RecordingDetail(
    val recording: Recording,
    val transcript: Transcript?,
    val summary: Summary?
)
