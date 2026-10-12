package com.kreativekoala.summaryai.ui.recordings.organize

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
import com.kreativekoala.summaryai.domain.model.Recording

/** Horizontal chip row: one chip per folder, then one per tag. Tapping a selected chip clears it. */
@Composable
fun FolderTagFilterRow(
    folders: List<FolderDto>,
    tags: List<String>,
    selectedFolderId: String?,
    selectedTag: String?,
    onFolder: (String?) -> Unit,
    onTag: (String?) -> Unit,
) {
    if (folders.isEmpty() && tags.isEmpty()) return
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        folders.forEach { f ->
            val selected = f.id == selectedFolderId
            OrganizeChip(label = f.name, selected = selected) { onFolder(if (selected) null else f.id) }
        }
        tags.forEach { t ->
            val selected = selectedTag?.equals(t, ignoreCase = true) == true
            OrganizeChip(label = "#$t", selected = selected) { onTag(if (selected) null else t) }
        }
    }
}

@Composable
private fun OrganizeChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
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
        item(key = "group-header-${group.label}") {
            Text(
                text = group.label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
            )
        }
        items(items = group.recordings, key = { it.id }) { recording -> itemContent(recording) }
    }
}
