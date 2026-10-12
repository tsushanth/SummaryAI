package com.kreativekoala.summaryai.ui.recordings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PersonOutline
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.ui.components.MmEmptyState
import com.kreativekoala.summaryai.ui.components.SkeletonBox
import com.kreativekoala.summaryai.ui.recordings.share.EditSpeakerNamesSheet
import com.kreativekoala.summaryai.ui.recordings.share.ShareExportSheet
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RecordingDetailScreen(
    recordingId: String,
    viewModel: RecordingDetailViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onUpgradeClick: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val detail = uiState.recordingDetail

    var showDeleteDialog by remember { mutableStateOf(false) }
    var showMoreMenu by remember { mutableStateOf(false) }
    var showShareSheet by remember { mutableStateOf(false) }
    var showSpeakerEditor by remember { mutableStateOf(false) }

    // Handle deletion
    LaunchedEffect(uiState.deleted) {
        if (uiState.deleted) {
            onNavigateBack()
        }
    }

    // Error handling
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(detail?.recording?.title ?: stringResource(R.string.recording_fallback)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = {
                    IconButton(onClick = { showMoreMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.more))
                    }
                    DropdownMenu(
                        expanded = showMoreMenu,
                        onDismissRequest = { showMoreMenu = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.export)) },
                            onClick = {
                                showMoreMenu = false
                                showShareSheet = true
                            },
                            leadingIcon = { Icon(Icons.Default.Share, contentDescription = null) }
                        )
                        DropdownMenuItem(
                            text = { Text("Rename Speakers") },
                            onClick = {
                                showMoreMenu = false
                                showSpeakerEditor = true
                            },
                            enabled = detail?.transcript != null,
                            leadingIcon = { Icon(Icons.Default.PersonOutline, contentDescription = null) }
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.delete)) },
                            onClick = {
                                showMoreMenu = false
                                showDeleteDialog = true
                            },
                            leadingIcon = {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        if (uiState.isLoading) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                SkeletonBox(Modifier.fillMaxWidth(), height = 96.dp)
                SkeletonBox(Modifier.fillMaxWidth(), height = 44.dp)
                SkeletonBox(Modifier.fillMaxWidth(0.7f), height = 18.dp)
                SkeletonBox(Modifier.fillMaxWidth(), height = 14.dp)
                SkeletonBox(Modifier.fillMaxWidth(), height = 14.dp)
                SkeletonBox(Modifier.fillMaxWidth(0.5f), height = 14.dp)
            }
        } else if (detail == null) {
            // Load failed (e.g. backend timeout): without this the screen was blank with no way out
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentAlignment = Alignment.Center
            ) {
                MmEmptyState(
                    icon = Icons.Default.CloudOff,
                    title = stringResource(R.string.error_load_recording_failed),
                    actionLabel = stringResource(R.string.retry),
                    onAction = viewModel::refresh
                )
            }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                // Audio player area
                AudioPlayerCard(
                    audioPlayerState = uiState.audioPlayerState,
                    durationFormatted = detail.recording.formattedDuration,
                    audioUrl = detail.recording.audioUrl,
                    onPlayPause = viewModel::togglePlayPause,
                    onSeekForward = viewModel::seekForward,
                    onSeekBackward = viewModel::seekBackward
                )

                // Processing indicator
                if (detail.recording.isProcessing) {
                    ProcessingIndicator(status = detail.recording.status.displayName)
                }

                // Styled tab picker with icons
                StyledTabPicker(
                    selectedTab = uiState.selectedTab,
                    onTabSelected = { viewModel.selectTab(it) }
                )

                val hasNoSpeech = detail.transcript?.hasNoSpeech == true

                // Tab content
                when (uiState.selectedTab) {
                    DetailTab.SUMMARY -> SummaryTab(
                        // An empty transcript makes the model reply with "please resubmit"; hide that
                        summary = detail.summary.takeUnless { hasNoSpeech },
                        hasNoSpeech = hasNoSpeech,
                        speakerNames = detail.transcript?.speakerNames
                    )
                    DetailTab.TRANSCRIPT -> TranscriptTab(
                        transcript = detail.transcript,
                        isLiveMeeting = detail.recording.isLiveMeeting,
                        meetingId = detail.recording.meetingId,
                        showLiveTranscript = uiState.showLiveTranscript,
                        onToggleLive = { viewModel.toggleLiveTranscript(it) },
                        currentPositionMs = uiState.audioPlayerState.currentPositionMs,
                        canSeek = detail.recording.audioUrl != null,
                        onSeekTo = viewModel::seekTo
                    )
                    DetailTab.CHAT -> ChatTab(
                        qaMessages = uiState.qaMessages,
                        currentQuestion = uiState.currentQuestion,
                        isAskingQuestion = uiState.isAskingQuestion,
                        onQuestionChange = viewModel::updateQuestion,
                        onAskQuestion = viewModel::askQuestion,
                        onSuggestedQuestion = { question ->
                            viewModel.updateQuestion(question)
                            viewModel.askQuestion()
                        }
                    )
                }
            }
        }

        // Delete confirmation dialog
        if (showDeleteDialog) {
            AlertDialog(
                onDismissRequest = { showDeleteDialog = false },
                title = { Text(stringResource(R.string.delete_recording)) },
                text = { Text(stringResource(R.string.delete_recording_confirm_generic)) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            showDeleteDialog = false
                            viewModel.deleteRecording()
                        },
                        enabled = !uiState.isDeleting
                    ) {
                        Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showDeleteDialog = false }) {
                        Text(stringResource(R.string.cancel))
                    }
                }
            )
        }

        // Share / Export bottom sheet
        if (showShareSheet && detail != null) {
            ShareExportSheet(
                recording = detail.recording,
                summary = detail.summary.takeUnless { detail.transcript?.hasNoSpeech == true },
                transcript = detail.transcript,
                onDismiss = { showShareSheet = false },
                onError = { msg ->
                    showShareSheet = false
                    scope.launch { snackbarHostState.showSnackbar(msg) }
                }
            )
        }

        // Rename Speakers bottom sheet
        if (showSpeakerEditor && detail?.transcript != null) {
            EditSpeakerNamesSheet(
                transcript = detail.transcript,
                onSave = { names ->
                    viewModel.updateSpeakerNames(names)
                    showSpeakerEditor = false
                },
                onDismiss = { showSpeakerEditor = false }
            )
        }
    }
}
