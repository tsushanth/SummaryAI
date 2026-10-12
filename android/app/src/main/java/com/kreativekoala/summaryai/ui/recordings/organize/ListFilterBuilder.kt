package com.kreativekoala.summaryai.ui.recordings.organize

import com.kreativekoala.summaryai.data.repository.RecordingsFilter
import java.time.ZoneId

/**
 * Maps the list screen's filter selections to the server-side query. The Favorites tab, the
 * folder/tag chips and the date range are all applied by the API so paging stays correct;
 * Meetings/Imported tabs pass [recordingType] so they page correctly too.
 */
fun buildRecordingsFilter(
    favoritesTab: Boolean,
    folderId: String?,
    tag: String?,
    range: DateRangeSelection?,
    zone: ZoneId = ZoneId.systemDefault(),
    recordingType: String? = null,
): RecordingsFilter = RecordingsFilter(
    folderId = folderId,
    tag = tag,
    favorite = if (favoritesTab) true else null,
    from = range?.fromIso(zone),
    to = range?.toIso(zone),
    recordingType = recordingType,
)
