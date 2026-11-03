package com.kreativekoala.summaryai.ui.meetings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.MeetingLanguages

/** Display name for a stored language code: its own-script name, or the localized "Auto-detect". */
@Composable
fun meetingLanguageLabel(code: String?): String =
    MeetingLanguages.nativeName(code) ?: stringResource(R.string.meeting_language_auto)

/** Tappable field showing the current choice; opens [MeetingLanguageDialog] via [onClick]. */
@Composable
fun MeetingLanguageField(
    selected: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    OutlinedCard(
        modifier = modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        shape = MaterialTheme.shapes.medium,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Default.Language,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                text = meetingLanguageLabel(selected),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** Auto-detect plus the allow-list, each in its own script. */
@Composable
fun MeetingLanguageDialog(
    selected: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
    note: String? = null,
) {
    val current = MeetingLanguages.normalize(selected)
    val rows = listOf(MeetingLanguages.AUTO) + MeetingLanguages.options.map { it.code }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.meeting_language_dialog_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (note != null) {
                    Text(
                        text = note,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                LazyColumn {
                    items(rows) { code ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .selectable(
                                    selected = code == current,
                                    role = Role.RadioButton,
                                    onClick = { onSelect(code) },
                                )
                                .padding(vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = code == current, onClick = null)
                            Spacer(Modifier.width(12.dp))
                            Text(
                                text = meetingLanguageLabel(code),
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
    )
}
