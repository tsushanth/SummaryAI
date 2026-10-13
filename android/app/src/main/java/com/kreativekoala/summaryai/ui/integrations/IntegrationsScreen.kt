package com.kreativekoala.summaryai.ui.integrations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.IntegrationDto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IntegrationsScreen(
    viewModel: IntegrationsViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.message) {
        uiState.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.integrations_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = stringResource(R.string.integrations_desc),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            IntegrationCard(
                kind = "webhook",
                title = stringResource(R.string.integration_webhook),
                state = uiState.integrations["webhook"],
                busy = uiState.busyKind == "webhook",
                showUrl = true,
                urlLabel = stringResource(R.string.integration_webhook_url),
                showSecret = true,
                secretLabel = stringResource(R.string.integration_webhook_secret),
                showDatabase = false,
                onSave = viewModel::save,
                onTest = viewModel::test,
                onRemove = viewModel::remove
            )
            IntegrationCard(
                kind = "slack",
                title = stringResource(R.string.integration_slack),
                state = uiState.integrations["slack"],
                busy = uiState.busyKind == "slack",
                showUrl = true,
                urlLabel = stringResource(R.string.integration_slack_url),
                showSecret = false,
                secretLabel = "",
                showDatabase = false,
                onSave = viewModel::save,
                onTest = viewModel::test,
                onRemove = viewModel::remove
            )
            IntegrationCard(
                kind = "notion",
                title = stringResource(R.string.integration_notion),
                state = uiState.integrations["notion"],
                busy = uiState.busyKind == "notion",
                showUrl = false,
                urlLabel = "",
                showSecret = true,
                secretLabel = stringResource(R.string.integration_notion_token),
                showDatabase = true,
                onSave = viewModel::save,
                onTest = viewModel::test,
                onRemove = viewModel::remove
            )
        }
    }
}

@Composable
private fun IntegrationCard(
    kind: String,
    title: String,
    state: IntegrationDto?,
    busy: Boolean,
    showUrl: Boolean,
    urlLabel: String,
    showSecret: Boolean,
    secretLabel: String,
    showDatabase: Boolean,
    onSave: (kind: String, url: String?, secret: String?, databaseId: String?, onResult: (Boolean) -> Unit) -> Unit,
    onTest: (String) -> Unit,
    onRemove: (String) -> Unit
) {
    val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
    // Secrets are write-only: fields start empty and the saved values are never shown.
    var url by remember(kind) { mutableStateOf("") }
    var secret by remember(kind) { mutableStateOf("") }
    var databaseId by remember(kind, state?.databaseId) { mutableStateOf(state?.databaseId ?: "") }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)

            if (state != null) {
                val host = state.displayHost?.let { " ($it)" } ?: ""
                Text(
                    text = stringResource(R.string.integration_connected) + host,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
                state.lastStatus?.let { status ->
                    val detail = if (status == "failed" && !state.lastError.isNullOrBlank()) ": ${state.lastError}" else ""
                    Text(
                        text = stringResource(R.string.integration_last_delivery, status) + detail,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (status == "failed") MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (showUrl) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(urlLabel) },
                    placeholder = { Text(if (state != null) stringResource(R.string.integration_leave_to_keep) else "https://") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth()
                )
            }
            if (showSecret) {
                OutlinedTextField(
                    value = secret,
                    onValueChange = { secret = it },
                    label = { Text(secretLabel) },
                    placeholder = { Text(if (state?.hasSecret == true) stringResource(R.string.integration_leave_to_keep) else "") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth()
                )
            }
            if (showDatabase) {
                OutlinedTextField(
                    value = databaseId,
                    onValueChange = { databaseId = it },
                    label = { Text(stringResource(R.string.integration_notion_database)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    enabled = !busy,
                    onClick = {
                        // Close the keyboard so the result message below it is actually visible.
                        focusManager.clearFocus()
                        onSave(
                            kind,
                            url.takeIf { it.isNotBlank() },
                            secret.takeIf { it.isNotBlank() },
                            databaseId.takeIf { it.isNotBlank() }
                        ) { saved ->
                            // Clear secret fields only once stored (never echoed back); keep input on failure.
                            if (saved) {
                                url = ""
                                secret = ""
                            }
                        }
                    }
                ) { Text(stringResource(R.string.integration_save)) }

                if (state != null) {
                    OutlinedButton(enabled = !busy, onClick = { focusManager.clearFocus(); onTest(kind) }) {
                        Text(stringResource(R.string.integration_test))
                    }
                    TextButton(enabled = !busy, onClick = { focusManager.clearFocus(); onRemove(kind) }) {
                        Text(stringResource(R.string.integration_remove))
                    }
                }
            }
        }
    }
}
