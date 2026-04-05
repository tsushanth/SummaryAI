package com.kreativekoala.summaryai.ui.recording

import android.Manifest
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.accompanist.permissions.shouldShowRationale
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.ui.components.LiveWaveform
import com.kreativekoala.summaryai.ui.theme.RecordingRed

@OptIn(ExperimentalPermissionsApi::class, ExperimentalMaterial3Api::class)
@Composable
fun RecordingScreen(
    viewModel: RecordingViewModel = hiltViewModel(),
    onRecordingComplete: (String) -> Unit,
    onCancel: () -> Unit,
    showAsTab: Boolean = false
) {
    val uiState by viewModel.uiState.collectAsState()
    val recordingState = uiState.recordingState

    // Permission handling
    val microphonePermission = rememberPermissionState(Manifest.permission.RECORD_AUDIO)

    // Handle upload completion
    LaunchedEffect(uiState.uploadedRecordingId) {
        uiState.uploadedRecordingId?.let { recordingId ->
            onRecordingComplete(recordingId)
        }
    }

    // Error handling
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error, recordingState.error) {
        val error = uiState.error ?: recordingState.error
        error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Pulsing animation for recording indicator
    val infiniteTransition = rememberInfiniteTransition(label = "recording_pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.2f,
        animationSpec = infiniteRepeatable(
            animation = tween(600, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_scale"
    )

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.record)) },
                navigationIcon = {
                    if (!showAsTab && recordingState.isRecording) {
                        IconButton(onClick = {
                            viewModel.cancel()
                            onCancel()
                        }) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.cancel))
                        }
                    }
                }
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            if (!microphonePermission.status.isGranted) {
                // Permission not granted
                PermissionRequest(
                    shouldShowRationale = microphonePermission.status.shouldShowRationale,
                    onRequestPermission = { microphonePermission.launchPermissionRequest() }
                )
            } else if (uiState.isUploading) {
                // Uploading
                UploadingContent(progress = uiState.uploadProgress)
            } else if (!recordingState.isRecording) {
                // Ready to record - iOS style
                ReadyToRecordContentIOS(
                    title = uiState.title,
                    onTitleChange = viewModel::updateTitle,
                    onStartRecording = viewModel::startRecording
                )
            } else {
                // Recording in progress
                RecordingContent(
                    durationSeconds = recordingState.durationSeconds,
                    isPaused = recordingState.isPaused,
                    amplitudes = recordingState.amplitudes,
                    title = uiState.title,
                    pulseScale = if (!recordingState.isPaused) pulseScale else 1f,
                    onTitleChange = viewModel::updateTitle,
                    onPause = viewModel::pauseRecording,
                    onResume = viewModel::resumeRecording,
                    onStop = viewModel::stopAndUpload
                )
            }
        }
    }
}

@Composable
private fun PermissionRequest(
    shouldShowRationale: Boolean,
    onRequestPermission: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            imageVector = Icons.Default.Mic,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = stringResource(R.string.permission_required),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = if (shouldShowRationale) {
                stringResource(R.string.microphone_permission_rationale)
            } else {
                stringResource(R.string.microphone_permission_required)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(24.dp))

        Button(onClick = onRequestPermission) {
            Text(stringResource(R.string.grant_permission))
        }
    }
}

@Composable
private fun ReadyToRecordContent(
    onStartRecording: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = stringResource(R.string.tap_to_start_recording),
            style = MaterialTheme.typography.headlineSmall
        )

        Spacer(modifier = Modifier.height(48.dp))

        FilledIconButton(
            onClick = onStartRecording,
            modifier = Modifier.size(96.dp),
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = RecordingRed
            )
        ) {
            Icon(
                imageVector = Icons.Default.Mic,
                contentDescription = stringResource(R.string.start_recording),
                modifier = Modifier.size(48.dp),
                tint = Color.White
            )
        }
    }
}

@Composable
private fun ReadyToRecordContentIOS(
    title: String,
    onTitleChange: (String) -> Unit,
    onStartRecording: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(modifier = Modifier.height(16.dp))

        // Recording Title input
        Text(
            text = stringResource(R.string.recording_title),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = title,
            onValueChange = onTitleChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(stringResource(R.string.enter_title)) },
            singleLine = true,
            colors = OutlinedTextFieldDefaults.colors(
                unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
                focusedBorderColor = MaterialTheme.colorScheme.primary
            )
        )

        Spacer(modifier = Modifier.weight(1f))

        // Large timer display (00:00)
        Text(
            text = "00 : 00",
            style = MaterialTheme.typography.displayLarge.copy(
                fontWeight = androidx.compose.ui.text.font.FontWeight.Light,
                letterSpacing = 8.sp
            ),
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(32.dp))

        // Ready to record text
        Text(
            text = stringResource(R.string.ready_to_record),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Large red circular record button
        Surface(
            onClick = onStartRecording,
            modifier = Modifier.size(80.dp),
            shape = CircleShape,
            color = RecordingRed,
            shadowElevation = 4.dp
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.fillMaxSize()
            ) {
                // Inner circle (white ring effect)
                Surface(
                    modifier = Modifier.size(72.dp),
                    shape = CircleShape,
                    color = Color.Transparent,
                    border = androidx.compose.foundation.BorderStroke(3.dp, Color.White.copy(alpha = 0.3f))
                ) {}
                // Inner red circle
                Surface(
                    modifier = Modifier.size(60.dp),
                    shape = CircleShape,
                    color = RecordingRed
                ) {}
            }
        }

        Spacer(modifier = Modifier.weight(1f))
    }
}

@Composable
private fun RecordingContent(
    durationSeconds: Int,
    isPaused: Boolean,
    amplitudes: List<Float>,
    title: String,
    pulseScale: Float,
    onTitleChange: (String) -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onStop: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Recording indicator
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .scale(pulseScale)
                    .clip(CircleShape)
                    .background(if (isPaused) Color.Gray else RecordingRed)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = if (isPaused) stringResource(R.string.recording_state_paused) else stringResource(R.string.recording_state_recording),
                style = MaterialTheme.typography.labelLarge,
                color = if (isPaused) Color.Gray else RecordingRed
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Duration
        Text(
            text = formatDuration(durationSeconds),
            style = MaterialTheme.typography.displayMedium
        )

        Spacer(modifier = Modifier.height(32.dp))

        // Title input
        OutlinedTextField(
            value = title,
            onValueChange = onTitleChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text(stringResource(R.string.recording_title)) },
            placeholder = { Text(stringResource(R.string.untitled_recording)) },
            singleLine = true
        )

        Spacer(modifier = Modifier.height(32.dp))

        // Waveform
        LiveWaveform(
            amplitudes = amplitudes,
            modifier = Modifier
                .fillMaxWidth()
                .height(120.dp)
        )

        Spacer(modifier = Modifier.weight(1f))

        // Control buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Pause/Resume button
            FilledTonalIconButton(
                onClick = if (isPaused) onResume else onPause,
                modifier = Modifier.size(64.dp)
            ) {
                Icon(
                    imageVector = if (isPaused) Icons.Default.PlayArrow else Icons.Default.Pause,
                    contentDescription = if (isPaused) stringResource(R.string.resume_recording) else stringResource(R.string.pause_recording),
                    modifier = Modifier.size(32.dp)
                )
            }

            // Stop button
            FilledIconButton(
                onClick = onStop,
                modifier = Modifier.size(80.dp),
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = RecordingRed
                )
            ) {
                Icon(
                    imageVector = Icons.Default.Stop,
                    contentDescription = stringResource(R.string.stop_recording),
                    modifier = Modifier.size(40.dp),
                    tint = Color.White
                )
            }

            // Placeholder for symmetry
            Spacer(modifier = Modifier.size(64.dp))
        }

        Spacer(modifier = Modifier.height(32.dp))
    }
}

@Composable
private fun UploadingContent(progress: Float) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = stringResource(R.string.uploading),
            style = MaterialTheme.typography.headlineSmall
        )

        Spacer(modifier = Modifier.height(24.dp))

        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier
                .fillMaxWidth()
                .height(8.dp)
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "${(progress * 100).toInt()}%",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

private fun formatDuration(seconds: Int): String {
    val hours = seconds / 3600
    val minutes = (seconds % 3600) / 60
    val secs = seconds % 60

    return if (hours > 0) {
        String.format("%d:%02d:%02d", hours, minutes, secs)
    } else {
        String.format("%02d:%02d", minutes, secs)
    }
}
