package com.kreativekoala.summaryai.ui.recordings.organize

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.data.api.models.FolderDto

/** What the user is currently doing in the folder manager. */
private sealed interface FolderDialog {
    data object Create : FolderDialog
    data class Rename(val folder: FolderDto) : FolderDialog
    data class Delete(val folder: FolderDto) : FolderDialog
}

/**
 * Folder manager: create, rename and delete (with confirmation). Stateless; the caller owns
 * the folder list and performs the repository calls. [initialFolderId] opens the rename
 * dialog straight away (used by long-press on a folder chip).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FolderManageSheet(
    folders: List<com.kreativekoala.summaryai.data.api.models.FolderDto>,
    onDismiss: () -> Unit,
    onCreate: (String) -> Unit,
    onRename: (FolderDto, String) -> Unit,
    onDelete: (FolderDto) -> Unit,
    initialFolderId: String? = null,
) {
    var dialog by remember {
        mutableStateOf<FolderDialog?>(folders.firstOrNull { it.id == initialFolderId }?.let { FolderDialog.Rename(it) })
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text("Folders", style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = { dialog = FolderDialog.Create }) {
                    Icon(Icons.Default.Add, contentDescription = null)
                    Text("New folder", modifier = Modifier.padding(start = 4.dp))
                }
            }
            if (folders.isEmpty()) {
                Text(
                    "No folders yet. Create one to group related recordings.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 16.dp),
                )
            } else {
                LazyColumn {
                    items(folders, key = { it.id }) { f ->
                        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f).padding(vertical = 8.dp)) {
                                Text(f.name, style = MaterialTheme.typography.bodyLarge)
                                Text(
                                    "${f.recordingCount} ${if (f.recordingCount == 1) "recording" else "recordings"}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            IconButton(onClick = { dialog = FolderDialog.Rename(f) }) {
                                Icon(Icons.Default.Edit, contentDescription = "Rename ${f.name}")
                            }
                            IconButton(onClick = { dialog = FolderDialog.Delete(f) }) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = "Delete ${f.name}",
                                    tint = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    when (val d = dialog) {
        FolderDialog.Create -> FolderNameDialog(
            title = "New folder",
            initial = "",
            confirmLabel = "Create",
            onDismiss = { dialog = null },
            onConfirm = { onCreate(it); dialog = null },
        )
        is FolderDialog.Rename -> FolderNameDialog(
            title = "Rename folder",
            initial = d.folder.name,
            confirmLabel = "Save",
            onDismiss = { dialog = null },
            onConfirm = { onRename(d.folder, it); dialog = null },
        )
        is FolderDialog.Delete -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text("Delete \"${d.folder.name}\"?") },
            text = {
                Text("The folder is removed. Its ${d.folder.recordingCount} recording(s) are kept and become unfiled.")
            },
            confirmButton = {
                TextButton(onClick = { onDelete(d.folder); dialog = null }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text("Cancel") } },
        )
        null -> Unit
    }
}

/** Trimmed, 1-60 chars (the server limit). */
internal fun isValidFolderName(name: String): Boolean = name.trim().length in 1..60

@Composable
private fun FolderNameDialog(
    title: String,
    initial: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var name by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { if (it.length <= 60) name = it },
                singleLine = true,
                label = { Text("Name") },
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(name.trim()) }, enabled = isValidFolderName(name)) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
