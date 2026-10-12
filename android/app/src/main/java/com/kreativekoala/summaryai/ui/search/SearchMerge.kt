package com.kreativekoala.summaryai.ui.search

import com.kreativekoala.summaryai.data.api.models.SearchHitDto
import com.kreativekoala.summaryai.data.api.models.SearchRecordingDto
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingStatus

/** Builds a list row from a server search hit when the recording is not among the loaded pages. */
internal fun SearchRecordingDto.toRecording(): Recording = Recording(
    id = id,
    title = title ?: "Recording",
    durationSeconds = durationSeconds ?: 0,
    status = status?.let { s -> RecordingStatus.values().firstOrNull { it.name.equals(s, ignoreCase = true) } }
        ?: RecordingStatus.COMPLETED,
    audioUrl = null,
    createdAt = createdAt ?: "",
    isFavorite = isFavorite ?: false,
    tags = tags ?: emptyList(),
    folderId = folderId,
)

/**
 * Local title matches first (instant, works offline), then every server hit not already
 * listed, in server order. A server hit uses the loaded copy of the recording when there is
 * one, otherwise a row built from the hit itself, so results are not limited to the
 * recordings loaded on this device.
 */
internal fun mergeSearchResults(query: String, loaded: List<Recording>, hits: List<SearchHitDto>): List<Recording> {
    val q = query.lowercase()
    val titleMatches = loaded.filter { it.title.lowercase().contains(q) }
    val seen = titleMatches.mapTo(HashSet()) { it.id }
    val loadedById = loaded.associateBy { it.id }
    val remote = hits.mapNotNull { hit ->
        if (!seen.add(hit.recording.id)) null else loadedById[hit.recording.id] ?: hit.recording.toRecording()
    }
    return titleMatches + remote
}
