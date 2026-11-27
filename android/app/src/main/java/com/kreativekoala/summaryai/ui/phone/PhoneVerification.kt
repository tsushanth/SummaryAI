package com.kreativekoala.summaryai.ui.phone

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.util.ApiErrors

/** The text of a message in the app's language. */
@Composable
internal fun phoneMessageText(message: PhoneMessage): String = when (message) {
    is PhoneMessage.Resource -> stringResource(message.res)
    is PhoneMessage.Failure -> ApiErrors.userMessage(LocalContext.current, message.error)
        ?: stringResource(R.string.api_error_server)
}

/** Registering the user's own number: type it, answer the call, type the shown code on the keypad. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun VerificationBottomSheet(
    state: Verification,
    onStart: (String) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit
) {
    var number by rememberSaveable { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = stringResource(R.string.ui_verify_phone_number),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            when (state) {
                Verification.Hidden -> Unit
                is Verification.Entry -> {
                    BodyText(R.string.phone_verify_intro)
                    OutlinedTextField(
                        value = number,
                        onValueChange = { number = it.take(20) },
                        label = { Text(stringResource(R.string.ui_phone_number)) },
                        supportingText = { Text(stringResource(R.string.phone_number_hint)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        isError = state.error != null
                    )
                    state.error?.let {
                        Text(phoneMessageText(it), color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                    }
                    BodyText(R.string.phone_verify_call_in_english)
                    Button(
                        onClick = { onStart(number) },
                        enabled = number.isNotBlank() && !state.sending,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
                    ) {
                        if (state.sending) CircularProgressIndicator(modifier = Modifier.size(24.dp))
                        else Text(stringResource(R.string.phone_verify_start))
                    }
                }
                is Verification.Waiting -> {
                    Text(state.phoneNumber, style = MaterialTheme.typography.titleMedium)
                    BodyText(R.string.phone_verify_instruction)
                    Text(
                        text = state.code,
                        style = MaterialTheme.typography.displayMedium,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 6.sp
                    )
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    BodyText(R.string.phone_verify_waiting)
                }
                Verification.Done -> {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(64.dp))
                    BodyText(R.string.ui_phone_verified_successfully)
                    Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                        Text(stringResource(R.string.voice_close))
                    }
                }
                is Verification.Failed -> {
                    Icon(Icons.Default.Error, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(64.dp))
                    BodyText(state.reason)
                    Button(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                        Text(stringResource(R.string.ui_try_again))
                    }
                }
            }
        }
    }
}

@Composable
private fun BodyText(@StringRes res: Int) {
    Text(
        text = stringResource(res),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center
    )
}

/** Wire value to label, in the order offered. */
internal val BUSINESS_TYPES: List<Pair<String, Int>> = listOf(
    "home_services" to R.string.phone_business_home_services,
    "health" to R.string.phone_business_health,
    "beauty" to R.string.phone_business_beauty,
    "food" to R.string.phone_business_food,
    "real_estate" to R.string.phone_business_real_estate,
    "professional" to R.string.phone_business_professional,
    "retail" to R.string.phone_business_retail,
    "automotive" to R.string.phone_business_automotive,
    "education" to R.string.phone_business_education,
    "other" to R.string.phone_business_other
)

/** "Is this for a business?" Asked once, skippable; closing the sheet counts as skipping. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun BusinessQuestionSheet(onAnswer: (business: String, type: String?) -> Unit) {
    var isBusiness by rememberSaveable { mutableStateOf(false) }
    var type by rememberSaveable { mutableStateOf<String?>(null) }
    ModalBottomSheet(
        onDismissRequest = { onAnswer(if (isBusiness) "business" else "skipped", type) },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = stringResource(if (isBusiness) R.string.phone_business_type else R.string.phone_business_question),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
            if (!isBusiness) {
                Button(onClick = { isBusiness = true }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.phone_business_yes))
                }
                OutlinedButton(onClick = { onAnswer("personal", null) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.phone_business_no))
                }
                TextButton(onClick = { onAnswer("skipped", null) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.phone_business_skip))
                }
            } else {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BUSINESS_TYPES.forEach { (value, label) ->
                        FilterChip(
                            selected = type == value,
                            onClick = { type = if (type == value) null else value },
                            label = { Text(stringResource(label)) }
                        )
                    }
                }
                Button(onClick = { onAnswer("business", type) }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.phone_business_continue))
                }
            }
        }
    }
}
