package com.kreativekoala.summaryai.ui.calendar

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.CalendarConnection

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarIntegrationScreen(
    viewModel: CalendarViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Handle OAuth URL
    LaunchedEffect(uiState.oauthUrl) {
        uiState.oauthUrl?.let { url ->
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            context.startActivity(intent)
            viewModel.clearOAuthUrl()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.calendar_integration)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
        ) {
            Text(
                text = stringResource(R.string.calendar_integration_desc),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else {
                // Connected calendars
                uiState.connections.forEach { connection ->
                    ConnectedCalendarItem(
                        connection = connection,
                        onDisconnect = { viewModel.disconnect(connection.provider) }
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                }

                // Available providers to connect
                val connectedProviders = uiState.connections.map { it.provider.lowercase() }

                if ("google" !in connectedProviders) {
                    CalendarProviderItem(
                        name = stringResource(R.string.google_calendar),
                        icon = Icons.Default.Event,
                        iconTint = Color(0xFFDB4437),
                        onClick = { viewModel.connectGoogle() }
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                }

                if ("microsoft" !in connectedProviders) {
                    CalendarProviderItem(
                        name = stringResource(R.string.microsoft_outlook),
                        icon = Icons.Default.Email,
                        iconTint = Color(0xFF0078D4),
                        onClick = { viewModel.connectMicrosoft() }
                    )
                }
            }
        }
    }
}

@Composable
private fun ConnectedCalendarItem(
    connection: CalendarConnection,
    onDisconnect: () -> Unit
) {
    var showDisconnectDialog by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = if (connection.isGoogle) Icons.Default.Event else Icons.Default.Email,
                contentDescription = null,
                tint = if (connection.isGoogle) Color(0xFFDB4437) else Color(0xFF0078D4),
                modifier = Modifier.size(24.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = connection.providerDisplayName,
                    style = MaterialTheme.typography.titleMedium
                )
                connection.providerEmail?.let { email ->
                    Text(
                        text = email,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            TextButton(
                onClick = { showDisconnectDialog = true },
                colors = ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Text(stringResource(R.string.disconnect))
            }
        }
    }

    if (showDisconnectDialog) {
        AlertDialog(
            onDismissRequest = { showDisconnectDialog = false },
            title = { Text(stringResource(R.string.disconnect_calendar_title, connection.providerDisplayName)) },
            text = { Text(stringResource(R.string.disconnect_calendar_desc)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDisconnectDialog = false
                        onDisconnect()
                    }
                ) {
                    Text(stringResource(R.string.disconnect), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDisconnectDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }
}

@Composable
private fun CalendarProviderItem(
    name: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = iconTint,
                modifier = Modifier.size(24.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Text(
                text = name,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f)
            )

            Icon(
                Icons.Default.Add,
                contentDescription = stringResource(R.string.connect),
                tint = MaterialTheme.colorScheme.primary
            )
        }
    }
}
