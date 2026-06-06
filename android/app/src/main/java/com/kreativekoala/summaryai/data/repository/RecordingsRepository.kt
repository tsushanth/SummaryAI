package com.kreativekoala.summaryai.data.repository

import android.util.Log
import com.kreativekoala.summaryai.data.api.ProgressRequestBody
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.di.UploadClient
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingDetail
import com.kreativekoala.summaryai.domain.model.Summary
import com.kreativekoala.summaryai.domain.model.Transcript
import com.kreativekoala.summaryai.domain.model.TranscriptSegment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

private const val TAG = "RecordingsRepository"

/**
 * Repository for recording-related operations
 */
@Singleton
class RecordingsRepository @Inject constructor(
    private val api: SummaryAIApi,
    @UploadClient private val uploadClient: OkHttpClient
) {
    /**
     * Get paginated list of recordings
     */
    suspend fun getRecordings(
        page: Int = 1,
        perPage: Int = 20,
        status: RecordingStatus? = null
    ): Result<List<Recording>> = withContext(Dispatchers.IO) {
        try {
            Log.i(TAG, "=== Fetching recordings - page: $page, perPage: $perPage ===")
            val response = api.getRecordings(
                page = page,
                perPage = perPage,
                status = status?.name?.lowercase()
            )
            Log.i(TAG, "=== Received ${response.recordings.size} recordings, total: ${response.pagination.total} ===")
            response.recordings.forEachIndexed { index, recording ->
                Log.d(TAG, "Recording[$index]: id=${recording.id}, title=${recording.title}, status=${recording.status}")
            }
            Result.success(response.recordings.map { it.toDomain() })
        } catch (e: Exception) {
            Log.e(TAG, "Failed to fetch recordings", e)
            Result.failure(e)
        }
    }

    /**
     * Get recording with optional transcript and summary
     */
    suspend fun getRecording(
        id: String,
        includeTranscript: Boolean = false,
        includeSummary: Boolean = false
    ): Result<RecordingDetail> = withContext(Dispatchers.IO) {
        try {
            val includes = mutableListOf<String>()
            if (includeTranscript) includes.add("transcript")
            if (includeSummary) includes.add("summary")

            val response = api.getRecording(
                id = id,
                include = if (includes.isNotEmpty()) includes.joinToString(",") else null
            )
            Result.success(response.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Upload a new recording
     */
    suspend fun uploadRecording(
        title: String,
        audioFile: File,
        durationSeconds: Int,
        onProgress: (Float) -> Unit = {}
    ): Result<Recording> = withContext(Dispatchers.IO) {
        try {
            val fileSize = audioFile.length()
            Log.d(TAG, "Creating recording - title: $title, duration: $durationSeconds, size: $fileSize")

            // Step 1: Create recording and get upload URL
            val createResponse = api.createRecording(
                CreateRecordingRequest(
                    title = title,
                    durationSeconds = durationSeconds,
                    fileSizeBytes = fileSize
                )
            )
            Log.d(TAG, "Recording created: id=${createResponse.recording.id}")

            // Step 2: Upload file to storage
            val uploadInfo = createResponse.upload
            val body = ProgressRequestBody(
                delegate = audioFile.asRequestBody("audio/mp4".toMediaType()),
                onProgress = onProgress
            )
            val request = Request.Builder()
                .url(uploadInfo.url)
                .apply {
                    uploadInfo.headers.forEach { (key, value) ->
                        addHeader(key, value)
                    }
                }
                .put(body)
                .build()

            val uploadResponse = uploadClient.newCall(request).execute()
            if (!uploadResponse.isSuccessful) {
                throw Exception("Upload failed: ${uploadResponse.code}")
            }

            // Step 3: Complete upload
            Log.d(TAG, "Completing upload for recording: ${createResponse.recording.id}")
            val completeResponse = api.completeUpload(
                id = createResponse.recording.id,
                request = CompleteUploadRequest(fileSizeBytes = fileSize)
            )
            Log.d(TAG, "Upload completed: id=${completeResponse.recording.id}, status=${completeResponse.recording.status}")

            Result.success(completeResponse.recording.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Delete a recording
     */
    suspend fun deleteRecording(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            api.deleteRecording(id)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Ask a question about a recording
     */
    suspend fun askQuestion(
        recordingId: String,
        question: String
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val response = api.askQuestion(recordingId, AskQuestionRequest(question))
            Result.success(response.answer)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Update speaker names for a recording's transcript
     */
    suspend fun updateSpeakerNames(
        recordingId: String,
        speakerNames: Map<String, String>
    ): Result<Transcript> = withContext(Dispatchers.IO) {
        try {
            val response = api.updateSpeakerNames(recordingId, UpdateSpeakerNamesRequest(speakerNames))
            Result.success(response.transcript.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Toggle favorite status for a recording
     */
    suspend fun toggleFavorite(recordingId: String, isFavorite: Boolean): Result<Recording> = withContext(Dispatchers.IO) {
        try {
            val response = api.updateRecording(recordingId, UpdateRecordingRequest(isFavorite = isFavorite))
            Result.success(response.recording.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Rename a recording
     */
    suspend fun renameRecording(recordingId: String, title: String): Result<Recording> = withContext(Dispatchers.IO) {
        try {
            val response = api.updateRecording(recordingId, UpdateRecordingRequest(title = title))
            Result.success(response.recording.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Poll for recording status updates
     */
    fun pollRecordingStatus(recordingId: String, intervalMs: Long = 3000): Flow<Recording> = flow {
        while (true) {
            try {
                val response = api.getRecording(recordingId)
                emit(response.recording.toDomain())

                if (response.recording.status == RecordingStatus.COMPLETED ||
                    response.recording.status == RecordingStatus.FAILED
                ) {
                    break
                }
            } catch (e: Exception) {
                // Continue polling on error
            }
            kotlinx.coroutines.delay(intervalMs)
        }
    }.flowOn(Dispatchers.IO)
}

// Extension functions to convert DTOs to domain models
private fun RecordingDto.toDomain() = Recording(
    id = id,
    title = title ?: "Recording",
    durationSeconds = durationSeconds ?: 0,
    status = when (status) {
        RecordingStatus.PENDING -> com.kreativekoala.summaryai.domain.model.RecordingStatus.PENDING
        RecordingStatus.UPLOADING -> com.kreativekoala.summaryai.domain.model.RecordingStatus.UPLOADING
        RecordingStatus.UPLOADED -> com.kreativekoala.summaryai.domain.model.RecordingStatus.UPLOADED
        RecordingStatus.PROCESSING -> com.kreativekoala.summaryai.domain.model.RecordingStatus.PROCESSING
        RecordingStatus.TRANSCRIBING -> com.kreativekoala.summaryai.domain.model.RecordingStatus.TRANSCRIBING
        RecordingStatus.SUMMARIZING -> com.kreativekoala.summaryai.domain.model.RecordingStatus.SUMMARIZING
        RecordingStatus.COMPLETED -> com.kreativekoala.summaryai.domain.model.RecordingStatus.COMPLETED
        RecordingStatus.FAILED -> com.kreativekoala.summaryai.domain.model.RecordingStatus.FAILED
    },
    audioUrl = audioUrl,
    createdAt = createdAt ?: "",
    isFavorite = isFavorite ?: false,
    recordingType = when (recordingType) {
        RecordingType.GENERAL -> com.kreativekoala.summaryai.domain.model.RecordingType.GENERAL
        RecordingType.MEETING -> com.kreativekoala.summaryai.domain.model.RecordingType.MEETING
        RecordingType.LECTURE -> com.kreativekoala.summaryai.domain.model.RecordingType.LECTURE
        RecordingType.INTERVIEW -> com.kreativekoala.summaryai.domain.model.RecordingType.INTERVIEW
        RecordingType.VOICE_MEMO -> com.kreativekoala.summaryai.domain.model.RecordingType.VOICE_MEMO
        RecordingType.IMPORTED -> com.kreativekoala.summaryai.domain.model.RecordingType.IMPORTED
        null -> null
    },
    meetingId = meetingId
)

private fun GetRecordingResponse.toDomain() = RecordingDetail(
    recording = recording.toDomain().copy(audioUrl = audioUrl ?: recording.audioUrl),
    transcript = transcript?.toDomain(),
    summary = summary?.toDomain()
)

private fun TranscriptDto.toDomain() = Transcript(
    id = id ?: "",
    fullText = fullText ?: "",
    segments = segments?.map { it.toDomain() } ?: emptyList(),
    language = language,
    wordCount = wordCount ?: 0,
    speakerNames = speakerNames
)

private fun TranscriptSegmentDto.toDomain() = TranscriptSegment(
    startTime = startTime ?: 0.0,
    endTime = endTime ?: 0.0,
    text = text ?: "",
    speaker = speaker
)

private fun SummaryDto.toDomain() = Summary(
    id = id ?: "",
    shortSummary = shortSummary ?: "",
    detailedSummary = detailedSummary,
    keyPoints = keyPoints ?: emptyList(),
    actionItems = actionItems?.mapNotNull { it.title } ?: emptyList(),
    topics = topics ?: emptyList()
)
