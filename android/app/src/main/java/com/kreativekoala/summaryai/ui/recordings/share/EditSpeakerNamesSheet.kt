package com.kreativekoala.summaryai.ui.recordings.share

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.domain.model.Transcript

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditSpeakerNamesSheet(
    transcript: Transcript,
    onSave: (Map<String, String>) -> Unit,
    onDismiss: () -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)

    // Seed: keep any existing names + add slot for every unique speaker index
    // found in the segments (so users see all speakers even if the map is empty).
    val draft = remember {
        val initial = mutableStateMapOf<String, String>()
        transcript.speakerNames?.forEach { (k, v) -> initial[k] = v }
        transcript.segments.forEach { seg ->
            seg.speaker?.let { label ->
                Regex("""\d+""").find(label)?.value?.let { key ->
                    if (key !in initial) initial[key] = ""
                }
            }
        }
        if (initial.isEmpty()) {
            for (i in 0 until 2) initial[i.toString()] = "" // default 2 slots
        }
        initial
    }

    var isSaving by remember { mutableStateOf(false) }

    val sortedKeys = draft.keys.mapNotNull { it.toIntOrNull()?.let { idx -> idx to it } }
        .sortedBy { it.first }
        .map { it.second }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "Rename Speakers",
                    style = MaterialTheme.typography.titleMedium
                )
                Row {
                    TextButton(onClick = onDismiss, enabled = !isSaving) { Text("Cancel") }
                    TextButton(
                        onClick = {
                            isSaving = true
                            val filtered = draft.entries
                                .mapNotNull { (k, v) ->
                                    val t = v.trim()
                                    if (t.isEmpty()) null else k to t
                                }
                                .toMap()
                            onSave(filtered)
                        },
                        enabled = !isSaving
                    ) { Text(if (isSaving) "Saving…" else "Save") }
                }
            }
            HorizontalDivider()

            Column(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                sortedKeys.forEach { key ->
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Speaker $key",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.width(96.dp)
                        )
                        Spacer(Modifier.width(8.dp))
                        OutlinedTextField(
                            value = draft[key].orEmpty(),
                            onValueChange = { draft[key] = it },
                            placeholder = { Text("Name (optional)") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.Words,
                                imeAction = ImeAction.Done
                            ),
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
                Spacer(Modifier.padding(top = 8.dp))
                Text(
                    text = "Names replace “Speaker 0”, “Speaker 1”, etc. in the transcript, summary, and shared exports. Leave blank to keep the default.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
