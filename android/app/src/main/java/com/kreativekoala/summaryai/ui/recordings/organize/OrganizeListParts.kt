package com.kreativekoala.summaryai.ui.recordings.organize

import androidx.compose.ui.res.stringResource
import com.kreativekoala.summaryai.R
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.data.api.models.FolderDto
import com.kreativekoala.summaryai.data.repository.UNFILED_FOLDER_ID
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.util.LocaleDates

/** Horizontal chip row: one chip per folder, then one per tag. Tapping a selected chip clears it. */
@Composable
fun FolderTagFilterRow(
    folders: List<FolderDto>,
    tags: List<String>,
    selectedFolderId: String?,
    selectedTag: String?,
    onFolder: (String?) -> Unit,
    onTag: (String?) -> Unit,
    /** When set, a trailing "Manage" chip is shown (even with no folders yet) and opens folder management. */
    onManageFolders: (() -> Unit)? = null,
    /** Long-press on a folder chip. */
    onFolderLongPress: ((FolderDto) -> Unit)? = null,
    /** When set, a date-range chip is shown first. */
    dateRangeLabel: String? = null,
    onPickDateRange: (() -> Unit)? = null,
    onClearDateRange: (() -> Unit)? = null,
    /** When true, an "Unfiled" chip (folder_id=none) precedes the folder chips. */
    showUnfiled: Boolean = false,
) {
    if (folders.isEmpty() && tags.isEmpty() && onManageFolders == null && onPickDateRange == null) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (onPickDateRange != null) {
            val active = dateRangeLabel != null
            OrganizeChip(label = dateRangeLabel ?: stringResource(R.string.organize_any_date), selected = active) {
                if (active && onClearDateRange != null) onClearDateRange() else onPickDateRange()
            }
        }
        if (showUnfiled) {
            val selected = selectedFolderId == UNFILED_FOLDER_ID
            OrganizeChip(label = stringResource(R.string.organize_unfiled), selected = selected) { onFolder(if (selected) null else UNFILED_FOLDER_ID) }
        }
        folders.forEach { f ->
            val selected = f.id == selectedFolderId
            OrganizeChip(
                label = f.name,
                selected = selected,
                onLongClick = onFolderLongPress?.let { lp -> { lp(f) } },
            ) { onFolder(if (selected) null else f.id) }
        }
        tags.forEach { t ->
            val selected = selectedTag?.equals(t, ignoreCase = true) == true
            OrganizeChip(label = "#$t", selected = selected) { onTag(if (selected) null else t) }
        }
        if (onManageFolders != null) {
            OrganizeChip(label = stringResource(R.string.organize_manage_folders), selected = false) { onManageFolders() }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun OrganizeChip(label: String, selected: Boolean, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    Surface(
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier
                .combinedClickable(onClick = onClick, onLongClick = onLongClick)
                .padding(horizontal = 12.dp, vertical = 6.dp),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
        )
    }
}

/**
 * Emits "Starred / Today / Yesterday / This week / ..." headers followed by the
 * recordings of each group.
 */
fun LazyListScope.groupedRecordingItems(
    recordings: List<Recording>,
    itemContent: @Composable (Recording) -> Unit,
) {
    groupRecordingsByDate(recordings).forEach { group ->
        item(key = "group-header-${group.label.key}") {
            Text(
                text = groupLabelText(group.label),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
            )
        }
        items(items = group.recordings, key = { it.id }) { recording -> itemContent(recording) }
    }
}

/** Display text of a recordings-list group header, in the user's language. */
@Composable
internal fun groupLabelText(label: GroupLabel): String = when (label) {
    GroupLabel.Starred -> stringResource(R.string.group_starred)
    GroupLabel.Today -> stringResource(R.string.group_today)
    GroupLabel.Yesterday -> stringResource(R.string.group_yesterday)
    GroupLabel.ThisWeek -> stringResource(R.string.group_this_week)
    GroupLabel.ThisMonth -> stringResource(R.string.group_this_month)
    GroupLabel.Earlier -> stringResource(R.string.group_earlier)
    is GroupLabel.Month -> LocaleDates.monthYear(label.year, label.month)
}
