package com.kreativekoala.summaryai.ui.meetings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.*
import android.app.Activity
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JoinMeetingScreen(
    viewModel: JoinMeetingViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onMeetingJoined: (recordingId: String?) -> Unit,
    showAsTab: Boolean = false
) {
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadCoachingState()
    }

    LaunchedEffect(uiState.meetingJoined) {
        if (uiState.meetingJoined) {
            onMeetingJoined(uiState.joinedRecordingId)
        }
    }

    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        text = stringResource(R.string.join),
                        style = MaterialTheme.typography.headlineMedium
                    )
                },
                navigationIcon = {
                    if (!showAsTab) {
                        IconButton(onClick = onNavigateBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // Icon at top - purple circle with video icon
            Box(
                modifier = Modifier
                    .size(72.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFEDE7F6)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Videocam,
                    contentDescription = null,
                    modifier = Modifier.size(36.dp),
                    tint = Color(0xFF7C4DFF)
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Title
            Text(
                text = stringResource(R.string.join_meeting),
                style = MaterialTheme.typography.headlineSmall
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Description
            Text(
                text = stringResource(R.string.join_meeting_desc),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Meeting URL input
            Text(
                text = stringResource(R.string.meeting_url),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
            )

            OutlinedTextField(
                value = uiState.meetingUrl,
                onValueChange = viewModel::updateMeetingUrl,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(stringResource(R.string.meeting_url_placeholder)) },
                leadingIcon = {
                    Icon(
                        Icons.Default.Link,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
                )
            )

            Spacer(modifier = Modifier.height(20.dp))

            // Bot Name input
            Text(
                text = stringResource(R.string.bot_name),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth()
            )
            Text(
                text = stringResource(R.string.optional),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
            )

            OutlinedTextField(
                value = uiState.botName,
                onValueChange = viewModel::updateBotName,
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(stringResource(R.string.app_name)) },
                leadingIcon = {
                    Icon(
                        Icons.Default.Person,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
                )
            )

            Text(
                text = stringResource(R.string.bot_name_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp)
            )

            Spacer(modifier = Modifier.height(20.dp))

            // AI Coach toggle
            val activity = LocalContext.current as? Activity
            com.kreativekoala.summaryai.ui.coaching.CoachingToggleCard(
                enabled = uiState.coachingEnabled,
                onEnabledChange = viewModel::setCoachingEnabled,
                persona = uiState.coachingPersona,
                onPersonaChange = viewModel::setCoachingPersona,
                creditBalance = uiState.coachingCredits,
                isLoadingBalance = uiState.isLoadingCoachingCredits,
                onGetMoreCredits = {
                    val launched = activity?.let { viewModel.purchaseCoachingSubscription(it) } ?: false
                    // DEBUG fallback: if purchase couldn't launch (e.g. IAP not yet provisioned),
                    // grant 5 credits so developers can keep iterating without Play setup.
                    if (!launched && com.kreativekoala.summaryai.BuildConfig.DEBUG) {
                        viewModel.debugGrantCoachingCredits()
                    }
                }
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Join Meeting button
            Button(
                onClick = viewModel::joinMeeting,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                enabled = uiState.meetingUrl.isNotBlank() && !uiState.isJoining,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurface
                )
            ) {
                if (uiState.isJoining) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        color = MaterialTheme.colorScheme.onSurface
                    )
                } else {
                    Icon(
                        Icons.Default.Videocam,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(R.string.join_meeting))
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Supported Platforms section
            Text(
                text = stringResource(R.string.supported_platforms),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Platform icons row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                PlatformIcon(name = "Zoom", color = Color(0xFF2D8CFF))
                PlatformIcon(name = "Teams", color = Color(0xFF5059C9))
                PlatformIcon(name = "Meet", color = Color(0xFF00897B))
                PlatformIcon(name = "Webex", color = Color(0xFF00BCF2))
            }

            Spacer(modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun PlatformIcon(name: String, color: Color) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(color),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = name.first().toString(),
                style = MaterialTheme.typography.titleMedium,
                color = Color.White
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = name,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}
