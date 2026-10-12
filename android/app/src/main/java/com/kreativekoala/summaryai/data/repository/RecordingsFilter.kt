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
) {
    val isActive: Boolean
        get() = folderId != null || tag != null || favorite != null || from != null || to != null
}
