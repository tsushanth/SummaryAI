package com.kreativekoala.summaryai.ui.phone

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.PhoneCall

/** What the agent reported about one call: summary, what it collected and what was said. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CallResultSheet(
    call: PhoneCall,
    onRecordingClick: (String) -> Unit,
    onCallBack: () -> Unit,
    onDismiss: () -> Unit
) {
    val report = call.agent ?: return
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(call.toName ?: call.formattedToNumber, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                text = formatCallDate(LocalContext.current, call.startedAt ?: call.createdAt) +
                    (call.durationSeconds?.let { " • ${call.formattedDuration}" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            SelectionContainer {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    report.summary?.let {
                        Heading(R.string.summary)
                        Text(it)
                    }
                    if (report.collected.isNotEmpty()) {
                        Heading(R.string.phone_result_collected)
                        report.collected.forEach { (name, value) ->
                            Column {
                                Text(name, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(value)
                            }
                        }
                    }
                    if (report.transcript.isNotEmpty()) {
                        Heading(R.string.transcript)
                        report.transcript.forEach { turn ->
                            Column {
                                Text(
                                    stringResource(if (turn.fromAgent) R.string.phone_result_agent else R.string.phone_result_caller),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (turn.fromAgent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(turn.text)
                            }
                        }
                    }
                }
            }
            call.recordingId?.let { id ->
                Button(onClick = { onRecordingClick(id) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.recording_fallback))
                }
            }
            OutlinedButton(onClick = onCallBack, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.ui_call))
            }
        }
    }
}

@Composable
private fun Heading(res: Int) {
    Text(stringResource(res), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
}
