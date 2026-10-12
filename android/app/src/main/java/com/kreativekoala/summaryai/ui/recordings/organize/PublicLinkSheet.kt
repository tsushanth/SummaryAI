package com.kreativekoala.summaryai.ui.recordings.organize

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Create / revoke a public read-only link for a recording. The full URL is only
 * returned by the server at creation time (it stores a hash), so it is shown once
 * right after "Create link" with a Share action.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PublicLinkSheet(
    recordingId: String,
    onDismiss: () -> Unit,
    viewModel: PublicLinkViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var includeTranscript by remember { mutableStateOf(false) }
    // Days until expiry; null = never.
    var expiresInDays by remember { mutableStateOf<Int?>(7) }

    LaunchedEffect(recordingId) { viewModel.load(recordingId) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 24.dp)
        ) {
            Text("Public link", style = MaterialTheme.typography.titleMedium)
            Text(
                "Anyone with the link can read the summary" +
                    (if (includeTranscript) " and transcript" else "") + ". You can revoke it at any time.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 8.dp),
            )

            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Include full transcript", modifier = Modifier.weight(1f))
                Switch(checked = includeTranscript, onCheckedChange = { includeTranscript = it })
            }

            Text("Expires", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp))
            listOf<Pair<String, Int?>>("In 1 day" to 1, "In 7 days" to 7, "In 30 days" to 30, "Never" to null)
                .forEach { (label, days) ->
                    Row(
                        Modifier.fillMaxWidth().clickable { expiresInDays = days },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = expiresInDays == days, onClick = { expiresInDays = days })
                        Spacer(Modifier.width(8.dp))
                        Text(label)
                    }
                }

            Button(
                onClick = { viewModel.create(recordingId, includeTranscript, expiresInDays) },
                enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            ) { Text("Create link") }

            state.created?.let { created ->
                Text(
                    created.url,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 12.dp),
                )
                TextButton(onClick = { shareUrl(context, created.url) }) { Text("Share link") }
            }

            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            if (state.shares.isNotEmpty()) {
                HorizontalDivider(Modifier.padding(vertical = 12.dp))
                Text("Active links", style = MaterialTheme.typography.titleSmall)
                state.shares.forEach { s ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            (s.createdAt?.take(10) ?: "") +
                                (if (s.includeTranscript) " • transcript" else "") +
                                " • ${s.viewCount} views" +
                                (s.expiresAt?.let { " • expires ${it.take(10)}" } ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(
                            onClick = { viewModel.revoke(recordingId, s.id) },
                            enabled = !state.busy,
                        ) { Text("Revoke", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
}

private fun shareUrl(context: Context, url: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, url)
    }
    context.startActivity(Intent.createChooser(intent, "Share link").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
