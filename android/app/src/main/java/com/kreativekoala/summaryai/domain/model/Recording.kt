package com.kreativekoala.summaryai.domain.model

import androidx.annotation.StringRes
import com.kreativekoala.summaryai.R

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

    @get:StringRes
    val labelRes: Int
        get() = when (this) {
            PENDING -> R.string.status_bot_joining
            UPLOADING -> R.string.status_recording_progress
            UPLOADED -> R.string.status_processing_progress
            PROCESSING -> R.string.status_processing_progress
            TRANSCRIBING -> R.string.status_transcribing
            SUMMARIZING -> R.string.status_summarizing
            COMPLETED -> R.string.status_ready
            FAILED -> R.string.failed
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
    val meetingId: String? = null,
    val tags: List<String> = emptyList(),
    val folderId: String? = null,
    val summaryTemplate: String? = null
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
