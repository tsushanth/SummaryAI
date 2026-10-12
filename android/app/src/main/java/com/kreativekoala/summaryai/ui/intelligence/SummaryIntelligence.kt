package com.kreativekoala.summaryai.ui.intelligence

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmSectionHeader

/**
 * Template picker + "Regenerate summary" + "Draft follow-up email" for the recording detail summary tab.
 *
 * @param currentTemplateId template stored on the recording (from the recording payload), if known
 * @param onRegenerated called after a successful regenerate so the host reloads the recording
 * @param onMessage shows a transient message (snackbar) in the host
 */
@Composable
fun SummaryIntelligenceCard(
    currentTemplateId: String?,
    onRegenerated: () -> Unit,
    onMessage: (String) -> Unit,
    viewModel: RecordingIntelligenceViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    var confirmTemplate by remember { mutableStateOf<String?>(null) }
    var menuOpen by remember { mutableStateOf(false) }

    IntelligenceMessages(viewModel, onMessage)

    val appliedId = state.appliedTemplate ?: currentTemplateId
    val picked = state.pickedTemplate ?: appliedId ?: state.defaultTemplate
    fun nameOf(id: String?): String? = state.templates.firstOrNull { it.id == id }?.name
    val currentName = nameOf(appliedId)

    MmCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            MmSectionHeader(title = stringResource(R.string.summary_template_title), icon = Icons.Default.AutoAwesome)
            Text(
                text = if (currentName != null) stringResource(R.string.summary_template_current, currentName)
                else stringResource(R.string.summary_template_not_set),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Column {
                OutlinedButton(
                    onClick = { menuOpen = true },
                    enabled = state.templates.isNotEmpty() && !state.isRegenerating,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(nameOf(picked) ?: "…", modifier = Modifier.weight(1f))
                    Icon(Icons.Default.ArrowDropDown, contentDescription = null)
                }
                DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                    state.templates.forEach { t ->
                        DropdownMenuItem(
                            text = {
                                Column {
                                    Text(t.name, style = MaterialTheme.typography.bodyLarge)
                                    if (t.description.isNotBlank()) {
                                        Text(
                                            t.description,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            },
                            onClick = {
                                menuOpen = false
                                viewModel.pickTemplate(t.id)
                            }
                        )
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { picked?.let { confirmTemplate = it } },
                    enabled = picked != null && !state.isRegenerating
                ) {
                    if (state.isRegenerating) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.size(8.dp))
                    Text(
                        stringResource(
                            if (state.isRegenerating) R.string.summary_template_regenerating
                            else R.string.summary_template_regenerate
                        )
                    )
                }
                TextButton(onClick = viewModel::openEmailSheet) {
                    Icon(Icons.Default.Email, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(8.dp))
                    Text(stringResource(R.string.followup_email))
                }
            }
        }
    }

    confirmTemplate?.let { id ->
        AlertDialog(
            onDismissRequest = { confirmTemplate = null },
            title = { Text(stringResource(R.string.summary_template_confirm_title)) },
            text = {
                Text(stringResource(R.string.summary_template_confirm_message, nameOf(id) ?: id))
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmTemplate = null
                    viewModel.regenerate(id, onRegenerated)
                }) { Text(stringResource(R.string.summary_template_regenerate_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { confirmTemplate = null }) { Text(stringResource(R.string.cancel)) }
            }
        )
    }

    if (state.showEmailSheet) {
        FollowUpEmailSheet(
            subject = state.emailDraft?.subject.orEmpty(),
            body = state.emailDraft?.body.orEmpty(),
            isLoading = state.isDraftingEmail || state.emailDraft == null,
            onEdit = viewModel::editDraft,
            onMessage = onMessage,
            onDismiss = viewModel::closeEmailSheet
        )
    }
}

/**
 * "Add to my todos" button shown under the summary's action items. Result messages are shown by
 * [SummaryIntelligenceCard], which must be on screen alongside it (it owns the event collector).
 */
@Composable
fun ActionItemsToTodosButton(
    viewModel: RecordingIntelligenceViewModel = hiltViewModel()
) {
    val state by viewModel.state.collectAsState()
    OutlinedButton(
        onClick = viewModel::addActionItemsToTodos,
        enabled = !state.isAddingTodos,
        modifier = Modifier.fillMaxWidth()
    ) {
        if (state.isAddingTodos) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        } else {
            Icon(Icons.Default.Checklist, contentDescription = null, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.size(8.dp))
        Text(
            stringResource(
                if (state.isAddingTodos) R.string.action_items_to_todos_adding else R.string.action_items_to_todos
            )
        )
    }
}

/** Collects one-shot events and turns them into localized messages. Only one composable should call this. */
@Composable
private fun IntelligenceMessages(viewModel: RecordingIntelligenceViewModel, onMessage: (String) -> Unit) {
    val context = LocalContext.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect { e ->
            // Template load failures are silent here: the picker just stays disabled.
            val msg = when (e) {
                IntelligenceEvent.TemplatesFailed -> null
                IntelligenceEvent.Regenerated -> context.getString(R.string.summary_template_done)
                IntelligenceEvent.RegenerateFailed -> context.getString(R.string.summary_template_failed)
                IntelligenceEvent.EmailFailed -> context.getString(R.string.followup_email_failed)
                IntelligenceEvent.TodosFailed -> context.getString(R.string.action_items_to_todos_failed)
                is IntelligenceEvent.TodosAdded -> when {
                    e.added == 0 -> context.getString(R.string.action_items_to_todos_none_new)
                    e.skipped > 0 -> context.getString(R.string.action_items_to_todos_added_skipped, e.added, e.skipped)
                    else -> context.getString(R.string.action_items_to_todos_added, e.added)
                }
            }
            msg?.let(onMessage)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FollowUpEmailSheet(
    subject: String,
    body: String,
    isLoading: Boolean,
    onEdit: (subject: String, body: String) -> Unit,
    onMessage: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(stringResource(R.string.followup_email_title), style = MaterialTheme.typography.titleLarge)

            if (isLoading) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.followup_email_drafting))
                }
                Spacer(Modifier.height(24.dp))
            } else {
                OutlinedTextField(
                    value = subject,
                    onValueChange = { onEdit(it, body) },
                    label = { Text(stringResource(R.string.followup_email_subject)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = body,
                    onValueChange = { onEdit(subject, it) },
                    label = { Text(stringResource(R.string.followup_email_body)) },
                    minLines = 8,
                    modifier = Modifier.fillMaxWidth()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        copyToClipboard(context, "$subject\n\n$body")
                        onMessage(context.getString(R.string.followup_email_copied))
                    }) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text(stringResource(R.string.copy))
                    }
                    Button(onClick = {
                        if (!sendEmail(context, subject, body)) {
                            onMessage(context.getString(R.string.followup_email_no_app))
                        }
                    }) {
                        Icon(Icons.Default.Send, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text(stringResource(R.string.followup_email_send))
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

private fun copyToClipboard(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("follow-up email", text))
}

/** Opens an email composer with subject and body prefilled. Returns false if no email app handles it. */
private fun sendEmail(context: Context, subject: String, body: String): Boolean {
    val intent = Intent(Intent.ACTION_SENDTO).apply {
        data = Uri.parse("mailto:")
        putExtra(Intent.EXTRA_SUBJECT, subject)
        putExtra(Intent.EXTRA_TEXT, body)
    }
    return try {
        context.startActivity(intent)
        true
    } catch (e: ActivityNotFoundException) {
        false
    }
}
