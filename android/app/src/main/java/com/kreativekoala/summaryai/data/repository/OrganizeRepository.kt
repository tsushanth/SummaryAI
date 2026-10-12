package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.CreateShareRequest
import com.kreativekoala.summaryai.data.api.models.CreateShareResponse
import com.kreativekoala.summaryai.data.api.models.FolderDto
import com.kreativekoala.summaryai.data.api.models.FolderNameRequest
import com.kreativekoala.summaryai.data.api.models.SearchHitDto
import com.kreativekoala.summaryai.data.api.models.ShareDto
import com.kreativekoala.summaryai.data.api.models.TagCountDto
import com.kreativekoala.summaryai.data.api.models.UpdateRecordingRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import javax.inject.Inject
import javax.inject.Singleton

/** Folders, tags, public share links and server-side search. */
@Singleton
class OrganizeRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    private suspend fun <T> io(block: suspend () -> T): Result<T> = withContext(Dispatchers.IO) {
        try {
            Result.success(block())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getFolders(): Result<List<FolderDto>> = io { api.getFolders().folders }

    suspend fun createFolder(name: String): Result<FolderDto> =
        io { api.createFolder(FolderNameRequest(name.trim())).folder }

    suspend fun renameFolder(id: String, name: String): Result<FolderDto> =
        io { api.renameFolder(id, FolderNameRequest(name.trim())).folder }

    suspend fun deleteFolder(id: String): Result<Unit> = io {
        api.deleteFolder(id)
        Unit
    }

    suspend fun getTags(): Result<List<TagCountDto>> = io { api.getTags().tags }

    /** folderId == null un-files the recording. */
    suspend fun moveToFolder(recordingId: String, folderId: String?): Result<Unit> = io {
        val json = if (folderId == null) "{\"folder_id\":null}" else "{\"folder_id\":\"$folderId\"}"
        api.setRecordingFolder(recordingId, json.toRequestBody("application/json".toMediaType()))
        Unit
    }

    suspend fun setTags(recordingId: String, tags: List<String>): Result<Unit> = io {
        api.updateRecording(recordingId, UpdateRecordingRequest(tags = tags))
        Unit
    }

    suspend fun getShares(recordingId: String): Result<List<ShareDto>> = io { api.getShares(recordingId).shares }

    suspend fun createShare(
        recordingId: String,
        includeTranscript: Boolean,
        expiresInDays: Int?
    ): Result<CreateShareResponse> = io {
        api.createShare(recordingId, CreateShareRequest(includeTranscript, expiresInDays))
    }

    suspend fun revokeShare(recordingId: String, shareId: String): Result<Unit> = io {
        api.revokeShare(recordingId, shareId)
        Unit
    }

    suspend fun search(query: String): Result<List<SearchHitDto>> = io { api.searchRecordings(query).results }
}
