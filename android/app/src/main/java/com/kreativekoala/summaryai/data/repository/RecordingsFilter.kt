package com.kreativekoala.summaryai.data.repository

/**
 * Server-side list filters for GET /api/recordings. All null = unfiltered.
 * [from] / [to] are ISO-8601 instants (UTC), inclusive.
 */
data class RecordingsFilter(
    val folderId: String? = null,
    val tag: String? = null,
    val favorite: Boolean? = null,
    val from: String? = null,
    val to: String? = null,
    /** Server `recording_type` value (e.g. "meeting", "imported"); null = all types. */
    val recordingType: String? = null,
) {
    val isActive: Boolean
        get() = folderId != null || tag != null || favorite != null || from != null || to != null || recordingType != null
}

/** Sentinel folder id meaning "recordings in no folder"; sent as `folder_id=none`. */
const val UNFILED_FOLDER_ID = "none"

