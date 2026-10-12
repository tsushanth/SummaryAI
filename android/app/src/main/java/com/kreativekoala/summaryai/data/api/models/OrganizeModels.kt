package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// Folders
data class FolderDto(
    val id: String,
    val name: String,
    @SerializedName("recording_count") val recordingCount: Int = 0
)

data class FoldersResponse(val folders: List<FolderDto>)
data class FolderResponse(val folder: FolderDto)
data class FolderNameRequest(val name: String)

// Tags
data class TagCountDto(val tag: String, val count: Int)
data class TagsResponse(val tags: List<TagCountDto>)

// Public share links
data class ShareDto(
    val id: String,
    @SerializedName("include_transcript") val includeTranscript: Boolean = false,
    @SerializedName("expires_at") val expiresAt: String? = null,
    @SerializedName("revoked_at") val revokedAt: String? = null,
    @SerializedName("view_count") val viewCount: Int = 0,
    @SerializedName("created_at") val createdAt: String? = null
)

data class SharesResponse(val shares: List<ShareDto>)

data class CreateShareRequest(
    @SerializedName("include_transcript") val includeTranscript: Boolean,
    /** null = never expires. Gson omits it, which the server treats as no expiry. */
    @SerializedName("expires_in_days") val expiresInDays: Int? = null
)

data class CreateShareResponse(
    val share: ShareDto,
    val token: String,
    val url: String
)

// Search
data class SearchHitDto(
    val recording: SearchRecordingDto,
    val match: String,
    val snippet: String
)

data class SearchRecordingDto(
    val id: String,
    val title: String? = null,
    @SerializedName("created_at") val createdAt: String? = null,
    @SerializedName("duration_seconds") val durationSeconds: Int? = null,
    val status: String? = null,
    @SerializedName("is_favorite") val isFavorite: Boolean? = null,
    val tags: List<String>? = null,
    @SerializedName("folder_id") val folderId: String? = null
)

data class SearchResponse(val results: List<SearchHitDto>)
