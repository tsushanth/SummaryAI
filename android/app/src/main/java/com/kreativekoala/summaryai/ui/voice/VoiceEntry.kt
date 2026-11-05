package com.kreativekoala.summaryai.ui.voice

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.service.voice.ActionDraft
import com.kreativekoala.summaryai.service.voice.OutwardIntentSpec
import com.kreativekoala.summaryai.service.voice.OutwardIntents
import com.kreativekoala.summaryai.service.voice.VoiceActionsViewModel
import com.kreativekoala.summaryai.service.voice.VoiceFunnel
import com.kreativekoala.summaryai.service.voice.VoicePhase
import java.time.LocalDate

/**
 * The hands-free entry point for a top bar. It draws nothing at all unless the build flag and the server both allow it,
 * so a build with the feature off shows no new UI.
 *
 * [recordingId] null = the Todos screen (listen for a command); non-null = a meeting screen ("Hear debrief").
 * [onEditDraft] hands a draft to the screen's own add-todo dialog; null hides the Edit button.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoiceEntryButton(
    recordingId: String? = null,
    onEditDraft: ((ActionDraft) -> Unit)? = null,
    onSaved: () -> Unit = {},
    viewModel: VoiceActionsViewModel = hiltViewModel(),
) {
    val ui by viewModel.ui.collectAsState()
    if (!ui.available) return
    val context = LocalContext.current
    val surface = if (recordingId == null) "todos" else "meeting"

    LaunchedEffect(surface) { viewModel.onEntryShown(surface) }

    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        viewModel.onMicPermission(granted)
    }
    LaunchedEffect(ui.needsMicPermission) {
        if (ui.needsMicPermission) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                viewModel.onMicPermission(true)
            } else {
                micLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
    LaunchedEffect(ui.editorDraft) {
        ui.editorDraft?.let {
            onEditDraft?.invoke(it)
            viewModel.editorHandled()
        }
    }
    // Refresh the screen's list when a change was saved or undone (not on first composition).
    var firstUndoState by remember { mutableStateOf(true) }
    LaunchedEffect(ui.canUndo) {
        if (firstUndoState) firstUndoState = false else onSaved()
    }
    LaunchedEffect(ui.message) {
        ui.message?.let {
            Toast.makeText(context, it, Toast.LENGTH_SHORT).show()
            viewModel.clearMessage()
        }
    }

    IconButton(onClick = {
        if (recordingId == null) viewModel.startListening(surface, null) else viewModel.startDebrief(recordingId)
    }) {
        Icon(
            Icons.Default.Mic,
            contentDescription = stringResource(if (recordingId == null) R.string.voice_entry_todos else R.string.voice_entry_debrief)
        )
    }

    if (ui.needsConsent) {
        AlertDialog(
            onDismissRequest = viewModel::declineConsent,
            title = { Text(stringResource(R.string.voice_consent_title)) },
            text = { Text(stringResource(R.string.voice_consent_body)) },
            confirmButton = { TextButton(onClick = viewModel::acceptConsent) { Text(stringResource(R.string.voice_consent_accept)) } },
            dismissButton = { TextButton(onClick = viewModel::declineConsent) { Text(stringResource(R.string.voice_consent_decline)) } },
        )
    }

    if (ui.open && !ui.needsConsent) {
        ModalBottomSheet(onDismissRequest = viewModel::close) {
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(stringResource(R.string.voice_sheet_title), style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when (ui.phase) {
                        VoicePhase.LISTENING -> { CircularProgressIndicator(Modifier.padding(2.dp), strokeWidth = 2.dp); Text(stringResource(R.string.voice_listening)) }
                        VoicePhase.WORKING -> { CircularProgressIndicator(Modifier.padding(2.dp), strokeWidth = 2.dp); Text(stringResource(R.string.voice_working)) }
                        VoicePhase.SPEAKING -> Text(stringResource(R.string.voice_speaking))
                        VoicePhase.IDLE -> if (ui.spoken.isBlank()) Text(stringResource(R.string.voice_try_hint), style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (ui.heard.isNotBlank()) {
                    Text("${stringResource(R.string.voice_heard_label)}: ${ui.heard}", style = MaterialTheme.typography.bodySmall)
                }
                if (ui.spoken.isNotBlank()) Text(ui.spoken, style = MaterialTheme.typography.bodyLarge)

                val draft = ui.draft
                if (draft != null && !ui.canUndo) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = viewModel::tapSave) { Text(stringResource(R.string.voice_save)) }
                        if (onEditDraft != null) OutlinedButton(onClick = viewModel::tapEdit) { Text(stringResource(R.string.voice_edit)) }
                        TextButton(onClick = viewModel::tapCancel) { Text(stringResource(R.string.voice_cancel)) }
                    }
                }
                if (ui.canUndo) {
                    OutlinedButton(onClick = viewModel::tapUndo) { Text(stringResource(R.string.voice_undo)) }
                }
                if (draft != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (draft.dueDate != null) {
                            TextButton(onClick = { launchOutward(context, OutwardIntents.calendarHold(draft.title, draft.dueDate, draft.assignee?.let { "Owner: $it" }), R.string.voice_no_calendar_app) }) {
                                Text(stringResource(R.string.voice_add_to_calendar))
                            }
                        }
                        TextButton(onClick = { launchOutward(context, OutwardIntents.emailForAction(draft, LocalDate.now()), R.string.voice_no_mail_app) }) {
                            Text(stringResource(R.string.voice_email_this))
                        }
                    }
                    Text(stringResource(R.string.voice_outward_note), style = MaterialTheme.typography.bodySmall)
                }
                TextButton(onClick = viewModel::close, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.voice_close)) }
            }
        }
    }
}

/** Opens the system app with the content filled in. The user's own tap there is the confirmation; nothing is sent from here. */
private fun launchOutward(context: Context, spec: OutwardIntentSpec?, missingApp: Int) {
    if (spec == null) return
    val funnel = VoiceFunnel()
    val intent = Intent(spec.action, spec.dataUri?.let { Uri.parse(it) }).apply {
        spec.extras.forEach { (k, v) ->
            when (v) {
                is String -> putExtra(k, v)
                is Long -> putExtra(k, v)
                is Boolean -> putExtra(k, v)
                is Int -> putExtra(k, v)
            }
        }
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    funnel.outwardPrepared(spec.kind)
    try {
        context.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, context.getString(missingApp), Toast.LENGTH_SHORT).show()
    }
}
