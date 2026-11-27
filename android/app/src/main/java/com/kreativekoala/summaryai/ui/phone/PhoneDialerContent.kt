package com.kreativekoala.summaryai.ui.phone

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
import com.kreativekoala.summaryai.ui.components.MmCard
import java.util.Locale

/** Free minutes and the user's own numbers: the caller ID shown to the person called. */
@Composable
internal fun PhoneHeader(
    state: PhoneUiState,
    onVerify: () -> Unit,
    onSelect: (String) -> Unit,
    onRemove: (VerifiedPhone) -> Unit
) {
    MmCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = if (state.serviceAvailable) {
                    stringResource(R.string.phone_minutes_left, state.minutesLeft, state.minutesPerMonth)
                } else {
                    stringResource(R.string.phone_service_used_up)
                },
                style = MaterialTheme.typography.bodyMedium
            )
            if (state.phones.isNotEmpty()) {
                Text(stringResource(R.string.phone_your_number), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            state.phones.forEach { phone ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = state.selectedPhone?.id == phone.id, onClick = { onSelect(phone.id) })
                    Text(phone.formattedPhoneNumber, modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
                    IconButton(onClick = { onRemove(phone) }) {
                        Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.phone_remove))
                    }
                }
            }
            if (state.phones.size < state.maxNumbers) {
                if (state.phones.isEmpty()) {
                    Text(stringResource(R.string.phone_verify_intro), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(onClick = onVerify, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.ui_verify_phone_number))
                    }
                } else {
                    TextButton(onClick = onVerify) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.ui_add_phone_number))
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun DialerContent(
    state: PhoneUiState,
    onNumberChange: (String) -> Unit,
    onNameChange: (String) -> Unit,
    onDigit: (String) -> Unit,
    onDelete: () -> Unit,
    onLanguage: (String) -> Unit,
    onCall: () -> Unit,
    header: @Composable () -> Unit
) {
    // One scrolling column, so nothing is cut off on short screens or with the keyboard open.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        header()
        if (state.phones.isEmpty()) return@Column
        OutlinedTextField(
            value = state.dialerNumber,
            onValueChange = onNumberChange,
            modifier = Modifier.fillMaxWidth(),
            textStyle = LocalTextStyle.current.copy(fontSize = 24.sp, textAlign = TextAlign.Center),
            label = { Text(stringResource(R.string.ui_enter_phone_number)) },
            supportingText = { Text(stringResource(R.string.phone_number_hint)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            singleLine = true
        )
        OutlinedTextField(
            value = state.dialerName,
            onValueChange = onNameChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.ui_contact_name_optional)) },
            singleLine = true
        )
        DialPad(onDigitClick = onDigit, onDeleteClick = onDelete)
        if (state.callLanguages.size > 1) {
            Text(stringResource(R.string.phone_call_language), style = MaterialTheme.typography.labelMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                state.callLanguages.forEach { code ->
                    val own = Locale.forLanguageTag(code)
                    FilterChip(
                        selected = state.callLanguage == code,
                        onClick = { onLanguage(code) },
                        label = { Text(own.getDisplayLanguage(own).replaceFirstChar { it.titlecase(own) }) }
                    )
                }
            }
            if (state.callLanguage != "en") {
                Text(stringResource(R.string.phone_call_language_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
        }
        FloatingActionButton(
            onClick = onCall,
            containerColor = Color(0xFF2E7D32),
            modifier = Modifier.size(72.dp)
        ) {
            if (state.starting) CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp))
            else Icon(Icons.Default.Phone, contentDescription = stringResource(R.string.ui_call), tint = Color.White, modifier = Modifier.size(32.dp))
        }
        Text(
            stringResource(R.string.phone_no_emergency),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
internal fun DialPad(
    onDigitClick: (String) -> Unit,
    onDeleteClick: () -> Unit
) {
    val rows = listOf(
        listOf("1" to "", "2" to "ABC", "3" to "DEF"),
        listOf("4" to "GHI", "5" to "JKL", "6" to "MNO"),
        listOf("7" to "PQRS", "8" to "TUV", "9" to "WXYZ")
    )
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                row.forEach { (digit, letters) -> DialPadButton(digit, letters) { onDigitClick(digit) } }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            DialPadButton("+", "") { onDigitClick("+") }
            DialPadButton("0", "") { onDigitClick("0") }
            IconButton(onClick = onDeleteClick, modifier = Modifier.size(64.dp)) {
                Icon(Icons.AutoMirrored.Filled.Backspace, contentDescription = stringResource(R.string.delete))
            }
        }
    }
}

@Composable
private fun DialPadButton(digit: String, letters: String, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.size(64.dp), shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(text = digit, style = MaterialTheme.typography.headlineSmall)
            if (letters.isNotEmpty()) {
                Text(text = letters, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Shown before every call: what happens, who will see which number, and the user's responsibility. */
@Composable
internal fun RecordingConsentDialog(consent: PendingConsent, onAccept: () -> Unit, onDecline: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDecline,
        title = { Text(stringResource(R.string.phone_consent_title)) },
        text = {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val to = consent.toName ?: com.kreativekoala.summaryai.domain.model.formatPhoneNumber(consent.to)
                Text(stringResource(R.string.phone_consent_numbers, to, consent.from.formattedPhoneNumber), fontWeight = FontWeight.Medium)
                Text(stringResource(R.string.phone_consent_body))
                Text(stringResource(R.string.phone_consent_responsibility))
                Text(stringResource(R.string.phone_no_emergency), style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { Button(onClick = onAccept) { Text(stringResource(R.string.phone_consent_accept)) } },
        dismissButton = { TextButton(onClick = onDecline) { Text(stringResource(R.string.cancel)) } }
    )
}
