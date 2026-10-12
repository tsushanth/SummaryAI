package com.kreativekoala.summaryai.ui.recordings.organize

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.domain.model.Recording

/**
 * Move a recording to a folder and edit its tags. [onChanged] is called after
 * every successful change so the caller can refresh its list.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun OrganizeSheet(
    recording: Recording,
    onDismiss: () -> Unit,
    onChanged: () -> Unit,
    viewModel: OrganizeViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    var folderId by remember { mutableStateOf(recording.folderId) }
    var tags by remember { mutableStateOf(recording.tags) }
    var newFolder by remember { mutableStateOf("") }
    var newTag by remember { mutableStateOf("") }

    fun addTag() {
        val t = newTag.trim().take(40)
        newTag = ""
        if (t.isEmpty() || tags.any { it.equals(t, ignoreCase = true) }) return
        val next = tags + t
        tags = next
        viewModel.setTags(recording.id, next, onChanged)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp)
        ) {
            Text(
                "Folder",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )
            FolderRow("No folder", selected = folderId == null) {
                folderId = null
                viewModel.moveToFolder(recording.id, null, onChanged)
            }
            state.folders.forEach { f ->
                FolderRow(f.name, selected = folderId == f.id) {
                    folderId = f.id
                    viewModel.moveToFolder(recording.id, f.id, onChanged)
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = newFolder,
                    onValueChange = { newFolder = it.take(60) },
                    label = { Text("New folder") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                TextButton(
                    enabled = newFolder.isNotBlank() && !state.busy,
                    onClick = {
                        val name = newFolder
                        newFolder = ""
                        viewModel.createFolderAndMove(recording.id, name, onChanged)
                    },
                ) { Text("Create") }
            }

            HorizontalDivider(Modifier.padding(vertical = 12.dp))

            Text(
                "Tags",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
            )
            FlowRow(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                tags.forEach { t ->
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.clickable {
                            val next = tags.filterNot { it == t }
                            tags = next
                            viewModel.setTags(recording.id, next, onChanged)
                        },
                    ) {
                        Text(
                            "#$t  ×",
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = newTag,
                    onValueChange = { newTag = it.take(40) },
                    label = { Text("Add tag") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                TextButton(enabled = newTag.isNotBlank() && !state.busy, onClick = { addTag() }) { Text("Add") }
            }

            state.error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
            TextButton(onClick = onDismiss, modifier = Modifier.padding(horizontal = 8.dp)) { Text("Done") }
        }
    }
}

@Composable
private fun FolderRow(name: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Spacer(Modifier.width(8.dp))
        Text(name, style = MaterialTheme.typography.bodyLarge)
    }
}
