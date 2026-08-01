package com.kreativekoala.summaryai.ui.meetings

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.LiveTranscriptSegment
import com.kreativekoala.summaryai.ui.coaching.ActiveCoachingSession
import com.kreativekoala.summaryai.ui.coaching.CoachingLivePanel
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@EntryPoint
@InstallIn(SingletonComponent::class)
interface ActiveCoachingSessionEntryPoint {
    fun activeCoachingSession(): ActiveCoachingSession
}

@Composable
fun LiveTranscriptView(
    meetingId: String,
    viewModel: LiveTranscriptViewModel = hiltViewModel(),
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()

    val context = androidx.compose.ui.platform.LocalContext.current
    val coaching = remember {
        EntryPointAccessors.fromApplication(context, ActiveCoachingSessionEntryPoint::class.java)
            .activeCoachingSession()
    }
    val coachingInsights by coaching.insights.collectAsState()
    val coachingActive by coaching.isActive.collectAsState()
    val hasCoachingSession = coaching.sessionId(meetingId) != null

    // Update meeting ID and start polling
    LaunchedEffect(meetingId) {
        viewModel.updateMeetingId(meetingId)
        viewModel.startPolling()
    }

    // Stop polling + end coaching when composable leaves
    DisposableEffect(Unit) {
        onDispose {
            viewModel.stopPolling()
            if (coaching.sessionId(meetingId) != null) {
                coaching.endActive()
            }
        }
    }

    // Auto-scroll to bottom when new segments arrive
    LaunchedEffect(uiState.segments.size) {
        if (uiState.segments.isNotEmpty()) {
            listState.animateScrollToItem(uiState.segments.size - 1)
        }
    }

    Column(modifier = modifier.fillMaxSize()) {
        // AI Coach live panel — only when a session is active for this meeting.
        if (hasCoachingSession) {
            CoachingLivePanel(
                insights = coachingInsights,
                isActive = coachingActive,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )
        }

        // Live indicator
        LiveIndicator()

        if (uiState.segments.isEmpty() && !uiState.isLoading) {
            // Empty state
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(32.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = stringResource(R.string.waiting_for_transcript),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.live_transcript_hint),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                        textAlign = TextAlign.Center
                    )
                }
            }
        } else {
            // Transcript segments
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                items(
                    items = uiState.segments,
                    key = { it.id }
                ) { segment ->
                    LiveTranscriptSegmentItem(
                        segment = segment,
                        speakerColor = viewModel.getSpeakerColor(segment.speakerId),
                        formattedTime = viewModel.formatTimestamp(segment.startTimestamp)
                    )
                }
            }
        }
    }
}

@Composable
private fun LiveIndicator() {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.3f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Pulsing red dot
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.error)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = stringResource(R.string.live_indicator),
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.error
            )
        }
    }
}

@Composable
private fun LiveTranscriptSegmentItem(
    segment: LiveTranscriptSegment,
    speakerColor: Color,
    formattedTime: String
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize(),
        horizontalArrangement = Arrangement.Start
    ) {
        // Timestamp
        Text(
            text = formattedTime,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
            modifier = Modifier.width(48.dp)
        )

        Spacer(modifier = Modifier.width(8.dp))

        // Speaker indicator and text
        Column(modifier = Modifier.weight(1f)) {
            // Speaker name with colored indicator
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(CircleShape)
                        .background(speakerColor)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = segment.displaySpeakerName,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Medium,
                    color = speakerColor
                )
                if (segment.isHost) {
                    Spacer(modifier = Modifier.width(6.dp))
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = MaterialTheme.colorScheme.primaryContainer
                    ) {
                        Text(
                            text = stringResource(R.string.host),
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Transcript text
            Text(
                text = segment.segmentText,
                style = MaterialTheme.typography.bodyMedium,
                fontStyle = if (segment.isPartial) FontStyle.Italic else FontStyle.Normal,
                color = if (segment.isPartial)
                    MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                else
                    MaterialTheme.colorScheme.onSurface
            )
        }
    }
}
