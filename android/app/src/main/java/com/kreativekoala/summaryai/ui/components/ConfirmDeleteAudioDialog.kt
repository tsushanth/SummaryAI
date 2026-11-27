package com.kreativekoala.summaryai.ui.components

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.kreativekoala.summaryai.R

/** Asked before anything deletes audio that exists only on this phone. Closing it any other way keeps the audio. */
@Composable
fun ConfirmDeleteAudioDialog(onDelete: () -> Unit, onKeep: () -> Unit) {
    AlertDialog(
        onDismissRequest = onKeep,
        title = { Text(stringResource(R.string.delete_audio_title)) },
        text = { Text(stringResource(R.string.delete_audio_message)) },
        confirmButton = {
            TextButton(onClick = onDelete) {
                Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error)
            }
        },
        dismissButton = {
            TextButton(onClick = onKeep) { Text(stringResource(R.string.cancel)) }
        }
    )
}
