package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// MARK: - Recording Status
enum class RecordingStatus {
    @SerializedName("pending") PENDING,
    @SerializedName("uploading") UPLOADING,
    @SerializedName("uploaded") UPLOADED,
    @SerializedName("processing") PROCESSING,
    @SerializedName("transcribing") TRANSCRIBING,
    @SerializedName("summarizing") SUMMARIZING,
    @SerializedName("completed") COMPLETED,
    @SerializedName("failed") FAILED
}

// MARK: - Recording Type
enum class RecordingType {
    @SerializedName("general") GENERAL,
    @SerializedName("meeting") MEETING,
    @SerializedName("lecture") LECTURE,
    @SerializedName("interview") INTERVIEW,
    @SerializedName("voice_memo") VOICE_MEMO,
    @SerializedName("imported") IMPORTED
}

// MARK: - Recording
data class RecordingDto(
    val id: String,
    @SerializedName("user_id") val userId: String,
    val title: String? = null,
    @SerializedName("audio_path") val audioPath: String?,
    @SerializedName("audio_url") val audioUrl: String?,
    @SerializedName("duration_seconds") val durationSeconds: Int? = null,
    @SerializedName("file_size_bytes") val fileSizeBytes: Long?,
    val status: RecordingStatus,
    val language: String?,
    @SerializedName("is_favorite") val isFavorite: Boolean? = null,
    @SerializedName("recording_type") val recordingType: RecordingType? = null,
    @SerializedName("meeting_id") val meetingId: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("updated_at") val updatedAt: String? = null
)

// MARK: - Transcript
data class TranscriptDto(
    val id: String? = null,
    @SerializedName("recording_id") val recordingId: String? = null,
    @SerializedName("full_text") val fullText: String? = null,
    val segments: List<TranscriptSegmentDto>? = null,
    val language: String? = null,
    @SerializedName("word_count") val wordCount: Int? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    /** Maps speaker_index (as string) to custom speaker name */
    @SerializedName("speaker_names") val speakerNames: Map<String, String>? = null
)

data class TranscriptSegmentDto(
    @SerializedName("start_time") val startTime: Double? = null,
    @SerializedName("end_time") val endTime: Double? = null,
    val text: String? = null,
    val speaker: String? = null,
    val confidence: Double? = null
)

// MARK: - Summary
data class SummaryDto(
    val id: String? = null,
    @SerializedName("recording_id") val recordingId: String? = null,
    @SerializedName("short_summary") val shortSummary: String? = null,
    @SerializedName("detailed_summary") val detailedSummary: String? = null,
    @SerializedName("key_points") val keyPoints: List<String>? = null,
    @SerializedName("action_items") val actionItems: List<ActionItemDto>? = null,
    val topics: List<String>? = null,
    val sentiment: String? = null,
    @SerializedName("created_at") val createdAt: String? = null
)

data class ActionItemDto(
    val title: String? = null,
    val description: String? = null,
    val assignee: String? = null,
    @SerializedName("due_date") val dueDate: String? = null,
    val priority: String? = null
)

// MARK: - API Requests

data class CreateRecordingRequest(
    val title: String,
    @SerializedName("duration_seconds") val durationSeconds: Int,
    @SerializedName("file_size_bytes") val fileSizeBytes: Long,
    @SerializedName("content_type") val contentType: String = "audio/mp4"
)

data class CompleteUploadRequest(
    @SerializedName("file_size_bytes") val fileSizeBytes: Long? = null,
    val checksum: String? = null
)

data class AskQuestionRequest(
    val question: String
)

data class UpdateSpeakerNamesRequest(
    @SerializedName("speaker_names") val speakerNames: Map<String, String>
)

data class UpdateRecordingRequest(
    val title: String? = null,
    @SerializedName("is_favorite") val isFavorite: Boolean? = null
)

data class UpdateRecordingResponse(
    val recording: RecordingDto
)

// MARK: - API Responses

data class CreateRecordingResponse(
    val recording: RecordingDto,
    val upload: UploadInfoDto
)

data class UploadInfoDto(
    val url: String,
    val method: String,
    val headers: Map<String, String>
)

data class CompleteUploadResponse(
    val recording: RecordingDto,
    val job: JobDto
)

data class JobDto(
    val id: String,
    val status: String
)

data class ListRecordingsResponse(
    val recordings: List<RecordingDto>,
    @SerializedName("meta") val pagination: PaginationDto
)

data class PaginationDto(
    val page: Int,
    @SerializedName("per_page") val perPage: Int,
    @SerializedName("total_count") val total: Int,
    @SerializedName("total_pages") val totalPages: Int
)

data class GetRecordingResponse(
    val recording: RecordingDto,
    val transcript: TranscriptDto?,
    val summary: SummaryDto?,
    @SerializedName("audio_url") val audioUrl: String? = null,
    @SerializedName("audio_url_expires_at") val audioUrlExpiresAt: String? = null
)

data class AskQuestionResponse(
    val answer: String,
    @SerializedName("relevant_segments") val relevantSegments: List<TranscriptSegmentDto>?
)

data class UpdateSpeakerNamesResponse(
    val transcript: TranscriptDto
)
