package com.kreativekoala.summaryai.ui.meetings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.Meeting
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmEmptyState
import com.kreativekoala.summaryai.ui.components.MmStatusPill
import com.kreativekoala.summaryai.ui.components.SkeletonCardList
import com.kreativekoala.summaryai.ui.navigation.LocalTabReselection
import java.text.SimpleDateFormat
import java.util.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeetingsScreen(
    viewModel: MeetingsViewModel = hiltViewModel(),
    onJoinMeetingClick: () -> Unit,
    onRecordingClick: (String) -> Unit,
    onConnectCalendarClick: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()

    // Handle tab re-selection - scroll to top for visual feedback
    val tabReselection = LocalTabReselection.current
    val reselectionCounter = tabReselection.reselectionCounter
    LaunchedEffect(reselectionCounter) {
        if (reselectionCounter > 0) {
            listState.animateScrollToItem(0)
        }
    }

    // Error handling
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
                        text = stringResource(R.string.calendar),
                        style = MaterialTheme.typography.headlineMedium
                    )
                }
            )
        }
    ) { paddingValues ->
        if (uiState.isLoading) {
            SkeletonCardList(
                count = 3,
                modifier = Modifier.padding(paddingValues),
                loadingDescription = stringResource(R.string.ui_loading)
            )
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Calendar connected banner - iOS style
                if (uiState.hasCalendarConnected) {
                    item {
                        CalendarConnectedBanner(
                            email = uiState.calendarConnections.firstOrNull()?.providerEmail ?: "Connected",
                            onRefresh = viewModel::refresh
                        )
                    }
                } else {
                    item {
                        ConnectCalendarCardIOS(onClick = onConnectCalendarClick)
                    }
                }

                // Manual join card — paste a Zoom/Meet/Teams link to send the
                // bot to a meeting that isn't on the connected calendar. Matches
                // the iOS MeetingsView "Join a Meeting" card.
                item {
                    JoinMeetingCard(onClick = onJoinMeetingClick)
                }

                // Upcoming meetings section
                if (uiState.upcomingMeetings.isNotEmpty()) {
                    item {
                        Text(
                            text = stringResource(R.string.upcoming),
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
                        )
                    }

                    items(
                        items = uiState.upcomingMeetings,
                        key = { it.id }
                    ) { meeting ->
                        MeetingCardIOS(
                            meeting = meeting,
                            onToggleAutoJoin = { viewModel.toggleAutoJoin(meeting) },
                            onRecordingClick = meeting.recordingId?.let { { onRecordingClick(it) } }
                        )
                    }
                } else if (uiState.hasCalendarConnected) {
                    item {
                        EmptyMeetingsContentIOS()
                    }
                }
            }
        }
    }
}

@Composable
private fun CalendarConnectedBanner(
    email: String,
    onRefresh: () -> Unit
) {
    MmCard(containerColor = MaterialTheme.colorScheme.secondaryContainer) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.calendar_connected),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSecondaryContainer
                )
                Text(
                    text = email,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSecondaryContainer
                )
            }

            IconButton(onClick = onRefresh) {
                Icon(
                    Icons.Default.Refresh,
                    contentDescription = stringResource(R.string.refresh),
                    tint = MaterialTheme.colorScheme.onSecondaryContainer
                )
            }
        }
    }
}

@Composable
private fun ConnectCalendarCardIOS(onClick: () -> Unit) {
    MmCard {
        MmEmptyState(
            icon = Icons.Default.CalendarMonth,
            title = stringResource(R.string.connect_calendar),
            message = stringResource(R.string.connect_calendar_desc),
            actionLabel = stringResource(R.string.connect_calendar),
            onAction = onClick
        )
    }
}

@Composable
private fun MeetingCardIOS(
    meeting: Meeting,
    onToggleAutoJoin: () -> Unit,
    onRecordingClick: (() -> Unit)?
) {
    MmCard {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = meeting.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Schedule,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = formatMeetingTime(meeting.startTime),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (meeting.platform != null) {
                Spacer(modifier = Modifier.height(8.dp))
                MmStatusPill(text = meeting.platformDisplayName)
            }

            HorizontalDivider(
                modifier = Modifier.padding(vertical = 12.dp),
                color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
            )

            // Auto-record toggle row; the whole row toggles so the target is 48dp+
            val autoRecordLabel = stringResource(R.string.auto_record)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .defaultMinSize(minHeight = 48.dp)
                    .toggleable(
                        value = meeting.autoJoin,
                        role = Role.Switch,
                        onValueChange = { onToggleAutoJoin() }
                    ),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = autoRecordLabel,
                    style = MaterialTheme.typography.bodyMedium
                )
                Switch(
                    checked = meeting.autoJoin,
                    onCheckedChange = null
                )
            }

            if (onRecordingClick != null) {
                Spacer(modifier = Modifier.height(8.dp))
                TextButton(
                    onClick = onRecordingClick,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(stringResource(R.string.view_recording))
                }
            }
        }
    }
}

@Composable
private fun EmptyMeetingsContentIOS() {
    MmEmptyState(
        icon = Icons.Default.EventAvailable,
        title = stringResource(R.string.no_upcoming_meetings),
        message = stringResource(R.string.meetings_empty_hint)
    )
}

@Composable
private fun formatMeetingTime(dateString: String?): String {
    if (dateString == null) return stringResource(R.string.now)
    return try {
        val inputFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
        val outputFormat = SimpleDateFormat("EEE, MMM d 'at' h:mm a", Locale.US)
        val date = inputFormat.parse(dateString)
        date?.let { outputFormat.format(it) } ?: dateString
    } catch (e: Exception) {
        dateString
    }
}

@Composable
private fun JoinMeetingCard(onClick: () -> Unit) {
    MmCard(onClick = onClick) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.VideoCall,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(24.dp)
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.join_meeting),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = stringResource(R.string.join_meeting_desc),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
