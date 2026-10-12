package com.kreativekoala.summaryai.ui.recordings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.StaticWaveform

/** Audio player card at the top of the recording detail screen. */
@Composable
internal fun AudioPlayerCard(
    audioPlayerState: AudioPlayerState,
    durationFormatted: String,
    audioUrl: String?,
    onPlayPause: () -> Unit,
    onSeekForward: () -> Unit,
    onSeekBackward: () -> Unit
) {
    val currentTime = formatPlayerTime(audioPlayerState.currentPositionMs)

    MmCard(
        modifier = Modifier
            .padding(horizontal = 16.dp)
            .padding(top = 4.dp, bottom = 8.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            StaticWaveform(
                progress = audioPlayerState.progress,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(40.dp)
            )

            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = currentTime,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onSeekBackward, enabled = audioUrl != null) {
                        Icon(Icons.Default.Replay10, contentDescription = stringResource(R.string.rewind_10s))
                    }

                    FilledIconButton(
                        onClick = onPlayPause,
                        modifier = Modifier.size(52.dp),
                        enabled = audioUrl != null
                    ) {
                        Icon(
                            if (audioPlayerState.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (audioPlayerState.isPlaying) stringResource(R.string.pause) else stringResource(R.string.play),
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    IconButton(onClick = onSeekForward, enabled = audioUrl != null) {
                        Icon(Icons.Default.Forward10, contentDescription = stringResource(R.string.forward_10s))
                    }
                }

                Text(
                    text = durationFormatted,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

internal fun formatPlayerTime(ms: Long): String {
    val totalSeconds = ms / 1000
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60

    return if (hours > 0) {
        String.format("%d:%02d:%02d", hours, minutes, seconds)
    } else {
        String.format("%d:%02d", minutes, seconds)
    }
}

@Composable
internal fun ProcessingIndicator(status: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.secondaryContainer
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            CircularProgressIndicator(
                modifier = Modifier.size(16.dp),
                strokeWidth = 2.dp
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = status,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSecondaryContainer
            )
        }
    }
}

/** Segmented Summary / Transcript / Chat picker. Each segment is a 48dp+ selectable tab. */
@Composable
internal fun StyledTabPicker(
    selectedTab: DetailTab,
    onTabSelected: (DetailTab) -> Unit
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
        DetailTab.entries.forEach { tab ->
            val isSelected = selectedTab == tab
            val tint = if (isSelected) MaterialTheme.colorScheme.onPrimary
            else MaterialTheme.colorScheme.onSurfaceVariant
            Row(
                modifier = Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 48.dp)
                    .clip(MaterialTheme.shapes.small)
                    .background(if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .selectable(selected = isSelected, role = Role.Tab, onClick = { onTabSelected(tab) })
                    .padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = when (tab) {
                        DetailTab.SUMMARY -> Icons.AutoMirrored.Filled.List
                        DetailTab.TRANSCRIPT -> Icons.Default.Description
                        DetailTab.CHAT -> Icons.AutoMirrored.Filled.Chat
                    },
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = tint
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = when (tab) {
                        DetailTab.SUMMARY -> stringResource(R.string.summary)
                        DetailTab.TRANSCRIPT -> stringResource(R.string.transcript)
                        DetailTab.CHAT -> stringResource(R.string.chat)
                    },
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Medium,
                    color = tint
                )
            }
        }
    }
}
