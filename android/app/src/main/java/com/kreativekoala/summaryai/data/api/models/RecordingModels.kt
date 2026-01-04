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

// MARK: - Recording
data class RecordingDto(
    val id: String,
    @SerializedName("user_id") val userId: String,
    val title: String,
    @SerializedName("audio_path") val audioPath: String?,
    @SerializedName("audio_url") val audioUrl: String?,
    @SerializedName("duration_seconds") val durationSeconds: Int,
    @SerializedName("file_size_bytes") val fileSizeBytes: Long?,
    val status: RecordingStatus,
    val language: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String
)

// MARK: - Transcript
data class TranscriptDto(
    val id: String,
    @SerializedName("recording_id") val recordingId: String,
    @SerializedName("full_text") val fullText: String?,
    val segments: List<TranscriptSegmentDto>?,
    val language: String?,
    @SerializedName("word_count") val wordCount: Int?,
    @SerializedName("created_at") val createdAt: String
)

data class TranscriptSegmentDto(
    @SerializedName("start_time") val startTime: Double,
    @SerializedName("end_time") val endTime: Double,
    val text: String,
    val speaker: String?,
    val confidence: Double?
)

// MARK: - Summary
data class SummaryDto(
    val id: String,
    @SerializedName("recording_id") val recordingId: String,
    @SerializedName("short_summary") val shortSummary: String?,
    @SerializedName("detailed_summary") val detailedSummary: String?,
    @SerializedName("key_points") val keyPoints: List<String>?,
    @SerializedName("action_items") val actionItems: List<ActionItemDto>?,
    val topics: List<String>?,
    val sentiment: String?,
    @SerializedName("created_at") val createdAt: String
)

data class ActionItemDto(
    val title: String,
    val description: String?,
    val assignee: String?,
    @SerializedName("due_date") val dueDate: String?,
    val priority: String?
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
    val pagination: PaginationDto
)

data class PaginationDto(
    val page: Int,
    @SerializedName("per_page") val perPage: Int,
    val total: Int,
    @SerializedName("total_pages") val totalPages: Int
)

data class GetRecordingResponse(
    val recording: RecordingDto,
    val transcript: TranscriptDto?,
    val summary: SummaryDto?
)

data class AskQuestionResponse(
    val answer: String,
    @SerializedName("relevant_segments") val relevantSegments: List<TranscriptSegmentDto>?
)
