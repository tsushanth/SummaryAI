package com.kreativekoala.summaryai.ui.phone

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.PhonePlanResponse
import com.kreativekoala.summaryai.domain.model.formatPhoneNumber
import com.kreativekoala.summaryai.ui.components.MmCard
import java.util.Locale

/** The account's own number and the agent that answers it. The same screen for the free trial and for a subscription. */
@Composable
internal fun OwnNumberContent(
    state: OwnNumberUiState,
    hasVerifiedPhone: Boolean,
    actions: OwnNumberViewModel,
    onVerify: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        val plan = state.plan
        when {
            plan == null && state.loading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            plan == null -> Button(onClick = actions::refresh, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.ui_try_again))
            }
            plan.number == null -> GetNumberCard(state, plan, hasVerifiedPhone, actions, onVerify)
            else -> {
                NumberCard(state, plan, actions)
                if (plan.agentsAvailable) AgentCard(state, plan, actions)
            }
        }
    }
    Dialogs(state, actions)
}

@Composable
private fun GetNumberCard(
    state: OwnNumberUiState,
    plan: PhonePlanResponse,
    hasVerifiedPhone: Boolean,
    actions: OwnNumberViewModel,
    onVerify: () -> Unit
) {
    val offers = numberOffers(plan)
    Section {
        if (!offers.any) {
            Text(stringResource(if (plan.trial?.used == true) R.string.phone_trial_ended else R.string.phone_error_unavailable))
            return@Section
        }
        Title(R.string.phone_own_title)
        Text(stringResource(R.string.phone_own_intro))
        if (!hasVerifiedPhone) {
            Note(stringResource(R.string.error_verify_phone_first))
            Button(onClick = onVerify, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.ui_verify_phone_number))
            }
            return@Section
        }
        if (offers.trial) {
            Text(
                stringResource(R.string.phone_trial_offer, plan.trial?.days ?: 0, plan.trial?.agentMinutes ?: 0),
                fontWeight = FontWeight.Medium
            )
        }
        if (offers.trial || offers.paidNumber) {
            Text(stringResource(R.string.phone_number_country), style = MaterialTheme.typography.labelMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val shown = LocalConfiguration.current.locales[0]
                listOf("US", "CA").forEach { code ->
                    FilterChip(
                        selected = state.country == code,
                        onClick = { actions.setCountry(code) },
                        label = { Text(Locale("", code).getDisplayCountry(shown)) }
                    )
                }
            }
            OutlinedTextField(
                value = state.areaCode,
                onValueChange = actions::setAreaCode,
                label = { Text(stringResource(R.string.phone_number_area_code)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            BusyButton(state.gettingNumber, stringResource(R.string.phone_number_get), onClick = actions::requestNumber)
        }
        val price = state.price
        if (offers.purchase && price != null) {
            val activity = LocalContext.current.findActivity()
            Text(stringResource(R.string.phone_plan_includes, plan.callMinutes ?: 0, plan.agentMinutes ?: 0))
            Button(onClick = { activity?.let(actions::buy) }, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.phone_subscribe, price))
            }
        }
    }
}

@Composable
private fun NumberCard(state: OwnNumberUiState, plan: PhonePlanResponse, actions: OwnNumberViewModel) {
    val number = plan.number ?: return
    Section {
        Note(stringResource(R.string.phone_own_number_label))
        SelectionContainer {
            Text(formatPhoneNumber(number.phoneNumber), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        val about = when {
            usableNumber(plan) == null -> R.string.phone_number_removing
            plan.agent != null -> R.string.phone_number_answers_agent
            else -> R.string.phone_number_rings_you
        }
        Text(stringResource(about))
        plan.subscription?.let {
            Note(stringResource(R.string.phone_plan_status, it.agentMinutesLeft ?: 0, it.callMinutesLeft ?: 0))
        }
        plan.trial?.active?.let { trial ->
            val ends = trial.endsAt?.let { formatCallDate(LocalContext.current, it) }.orEmpty()
            Note(stringResource(R.string.phone_trial_status, ends, trial.agentMinutesLeft ?: 0))
            TextButton(onClick = actions::askToEndTrial, enabled = !state.ending) {
                Text(stringResource(R.string.phone_trial_end))
            }
        }
    }
}

@Composable
private fun AgentCard(state: OwnNumberUiState, plan: PhonePlanResponse, actions: OwnNumberViewModel) {
    val shown = LocalConfiguration.current.locales[0]
    Section {
        Title(R.string.phone_agent_title)
        if (state.leftOut) Text(stringResource(R.string.phone_agent_left_out), color = MaterialTheme.colorScheme.primary)
        if (state.showAgentForm) {
            LaunchedEffect(Unit) { actions.formShown() }
            OutlinedTextField(
                value = state.prompt,
                onValueChange = actions::setPrompt,
                label = { Text(stringResource(R.string.phone_agent_prompt_label)) },
                placeholder = { Text(stringResource(R.string.phone_agent_prompt_hint)) },
                supportingText = { Text("${state.prompt.length} / $AGENT_PROMPT_MAX") },
                minLines = 4,
                enabled = !state.saving,
                modifier = Modifier.fillMaxWidth()
            )
            LanguagePicker(state, shown, actions::setLanguage)
            Note(stringResource(R.string.phone_agent_recording_note))
            BusyButton(
                busy = state.saving,
                label = stringResource(if (plan.agent == null) R.string.phone_agent_create else R.string.save),
                enabled = state.prompt.trim().length >= AGENT_PROMPT_MIN && state.languages.isNotEmpty(),
                onClick = actions::saveAgent
            )
            if (state.saving) Note(stringResource(R.string.phone_agent_saving))
            if (plan.agent != null) {
                TextButton(onClick = actions::cancelEdit, enabled = !state.saving) { Text(stringResource(R.string.cancel)) }
            }
        } else {
            plan.agent?.description?.let { Text(it) }
            plan.agent?.language?.let { Note(languageName(it, shown)) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = actions::editAgent) { Text(stringResource(R.string.edit)) }
                TextButton(onClick = actions::askToDeleteAgent) { Text(stringResource(R.string.phone_agent_delete)) }
            }
        }
        Note(stringResource(R.string.phone_agent_results_hint))
    }
}

internal fun languageName(code: String, shownIn: Locale): String =
    Locale.forLanguageTag(code).getDisplayLanguage(shownIn).ifEmpty { code }.replaceFirstChar { it.titlecase(shownIn) }

@Composable
private fun LanguagePicker(state: OwnNumberUiState, shown: Locale, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Text(stringResource(R.string.phone_agent_language), style = MaterialTheme.typography.labelMedium)
    Box {
        OutlinedButton(onClick = { open = true }, enabled = state.languages.isNotEmpty() && !state.saving) {
            Text(languageName(state.language, shown))
            Icon(Icons.Default.ArrowDropDown, contentDescription = null)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            state.languages.sortedBy { languageName(it, shown) }.forEach { code ->
                DropdownMenuItem(text = { Text(languageName(code, shown)) }, onClick = { onPick(code); open = false })
            }
        }
    }
}

@Composable
private fun Dialogs(state: OwnNumberUiState, actions: OwnNumberViewModel) {
    if (state.confirmTrial) {
        val trial = state.plan?.trial
        Confirm(
            title = R.string.phone_trial_confirm_title,
            text = stringResource(R.string.phone_trial_confirm_body, trial?.days ?: 0, trial?.agentMinutes ?: 0),
            accept = R.string.phone_trial_start,
            onAccept = actions::acceptTrial,
            onDismiss = actions::declineTrial
        )
    }
    if (state.confirmEnd) {
        Confirm(
            title = R.string.phone_trial_end_title,
            text = stringResource(R.string.phone_trial_end_body),
            accept = R.string.phone_trial_end,
            onAccept = actions::endTrial,
            onDismiss = actions::keepTrial
        )
    }
    if (state.confirmDelete) {
        Confirm(
            title = R.string.phone_agent_delete_title,
            text = stringResource(R.string.phone_agent_delete_body),
            accept = R.string.delete,
            onAccept = actions::deleteAgent,
            onDismiss = actions::keepAgent
        )
    }
}

@Composable
private fun Confirm(title: Int, text: String, accept: Int, onAccept: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(title)) },
        text = { Text(text, modifier = Modifier.verticalScroll(rememberScrollState())) },
        confirmButton = { Button(onClick = onAccept) { Text(stringResource(accept)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } }
    )
}

@Composable
private fun Section(content: @Composable ColumnScope.() -> Unit) {
    MmCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

@Composable
private fun Title(res: Int) {
    Text(stringResource(res), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
}

@Composable
private fun Note(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun BusyButton(busy: Boolean, label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        if (busy) CircularProgressIndicator(modifier = Modifier.size(24.dp)) else Text(label)
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
