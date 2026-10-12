package com.kreativekoala.summaryai.ui.recordings

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.Transcript
import com.kreativekoala.summaryai.domain.model.TranscriptSegment
import com.kreativekoala.summaryai.ui.components.MmEmptyState
import com.kreativekoala.summaryai.ui.components.SpeakerAvatar
import com.kreativekoala.summaryai.ui.meetings.LiveTranscriptView
import com.kreativekoala.summaryai.ui.recordings.share.applyingSpeakerNames
import com.kreativekoala.summaryai.ui.theme.speakerColor

@Composable
internal fun TranscriptTab(
    transcript: Transcript?,
    isLiveMeeting: Boolean = false,
    meetingId: String? = null,
    showLiveTranscript: Boolean = true,
    onToggleLive: (Boolean) -> Unit = {},
    currentPositionMs: Long = 0L,
    canSeek: Boolean = false,
    onSeekTo: (Long) -> Unit = {}
) {
    Column(modifier = Modifier.fillMaxSize()) {
        if (isLiveMeeting && meetingId != null) {
            LiveFullToggle(showLive = showLiveTranscript, onToggle = onToggleLive)
        }

        if (isLiveMeeting && meetingId != null && showLiveTranscript) {
            LiveTranscriptView(
                meetingId = meetingId,
                modifier = Modifier.weight(1f)
            )
        } else if (transcript == null || transcript.segments.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                MmEmptyState(
                    icon = Icons.Default.Description,
                    title = stringResource(R.string.transcript_not_available)
                )
            }
        } else {
            val positionSec = currentPositionMs / 1000.0
            // Only highlight once playback has advanced past the start
            val activeIndex = if (canSeek && currentPositionMs > 0L) {
                transcript.segments.indexOfLast { it.startTime <= positionSec }
            } else {
                -1
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                itemsIndexed(transcript.segments) { index, segment ->
                    TranscriptSegmentItem(
                        segment = segment,
                        speakerNames = transcript.speakerNames,
                        isActive = index == activeIndex,
                        canSeek = canSeek,
                        onSeek = { onSeekTo((segment.startTime * 1000).toLong()) }
                    )
                }
            }
        }
    }
}

@Composable
private fun LiveFullToggle(
    showLive: Boolean,
    onToggle: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .clip(MaterialTheme.shapes.medium)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        ToggleSegment(
            selected = showLive,
            modifier = Modifier.weight(1f),
            onClick = { onToggle(true) }
        ) { tint ->
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (showLive) MaterialTheme.colorScheme.error else tint)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = stringResource(R.string.live_label),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
                color = tint
            )
        }
        ToggleSegment(
            selected = !showLive,
            modifier = Modifier.weight(1f),
            onClick = { onToggle(false) }
        ) { tint ->
            Text(
                text = stringResource(R.string.full_label),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Medium,
                color = tint
            )
        }
    }
}

@Composable
private fun ToggleSegment(
    selected: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
    content: @Composable RowScope.(Color) -> Unit
) {
    val tint = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip(MaterialTheme.shapes.small)
            .background(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent)
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        content(tint)
    }
}

@Composable
private fun TranscriptSegmentItem(
    segment: TranscriptSegment,
    speakerNames: Map<String, String>?,
    isActive: Boolean,
    canSeek: Boolean,
    onSeek: () -> Unit
) {
    val speakerLabel = segment.speaker
    val displayName = speakerLabel?.applyingSpeakerNames(speakerNames)
    val text = segment.text.applyingSpeakerNames(speakerNames)
    val time = segment.formattedStartTime

    val spoken = if (displayName != null) {
        stringResource(R.string.ui_transcript_speaker_line, displayName, time, text)
    } else {
        "$time: $text"
    }
    val jumpLabel = stringResource(R.string.ui_transcript_jump_to, time)

    var rowModifier = Modifier
        .fillMaxWidth()
        .clip(MaterialTheme.shapes.small)
        .background(
            if (isActive) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent
        )
    if (canSeek) {
        rowModifier = rowModifier.clickable(onClickLabel = jumpLabel, onClick = onSeek)
    }
    rowModifier = rowModifier
        .padding(horizontal = 8.dp, vertical = 8.dp)
        .semantics(mergeDescendants = true) { contentDescription = spoken }

    Row(modifier = rowModifier, verticalAlignment = Alignment.Top) {
        if (speakerLabel != null) {
            SpeakerAvatar(label = speakerLabel, displayName = displayName, size = 32.dp)
        } else {
            Spacer(modifier = Modifier.size(32.dp))
        }
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f).clearAndSetSemantics { }) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (displayName != null) {
                    Text(
                        text = displayName,
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = speakerColor(speakerLabel)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(
                    text = time,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(text = text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
