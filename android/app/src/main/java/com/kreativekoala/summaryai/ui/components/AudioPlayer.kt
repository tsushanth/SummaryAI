package com.kreativekoala.summaryai.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Audio player composable with playback controls
 */
@Composable
fun AudioPlayerControls(
    audioUrl: String?,
    durationMs: Long,
    modifier: Modifier = Modifier,
    onSeek: (Long) -> Unit = {}
) {
    var isPlaying by remember { mutableStateOf(false) }
    var currentPosition by remember { mutableLongStateOf(0L) }
    var playbackSpeed by remember { mutableFloatStateOf(1f) }
    var showSpeedMenu by remember { mutableStateOf(false) }

    val progress = if (durationMs > 0) currentPosition.toFloat() / durationMs else 0f

    Column(
        modifier = modifier.fillMaxWidth()
    ) {
        // Waveform / Progress
        StaticWaveform(
            progress = progress,
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Slider
        Slider(
            value = progress,
            onValueChange = { newProgress ->
                val newPosition = (newProgress * durationMs).toLong()
                currentPosition = newPosition
                onSeek(newPosition)
            },
            modifier = Modifier.fillMaxWidth()
        )

        // Time labels
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = formatTime(currentPosition),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = formatTime(durationMs),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Controls
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Speed control
            Box {
                TextButton(onClick = { showSpeedMenu = true }) {
                    Text("${playbackSpeed}x")
                }
                DropdownMenu(
                    expanded = showSpeedMenu,
                    onDismissRequest = { showSpeedMenu = false }
                ) {
                    listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 2f).forEach { speed ->
                        DropdownMenuItem(
                            text = { Text("${speed}x") },
                            onClick = {
                                playbackSpeed = speed
                                showSpeedMenu = false
                            }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Rewind 10s
            IconButton(onClick = {
                val newPosition = (currentPosition - 10000).coerceAtLeast(0)
                currentPosition = newPosition
                onSeek(newPosition)
            }) {
                Icon(Icons.Default.Replay10, contentDescription = stringResource(R.string.rewind_10s))
            }

            // Play/Pause
            FilledIconButton(
                onClick = { isPlaying = !isPlaying },
                modifier = Modifier.size(56.dp)
            ) {
                Icon(
                    imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                    contentDescription = if (isPlaying) stringResource(R.string.pause) else stringResource(R.string.play),
                    modifier = Modifier.size(32.dp)
                )
            }

            // Forward 10s
            IconButton(onClick = {
                val newPosition = (currentPosition + 10000).coerceAtMost(durationMs)
                currentPosition = newPosition
                onSeek(newPosition)
            }) {
                Icon(Icons.Default.Forward10, contentDescription = stringResource(R.string.forward_10s))
            }

            Spacer(modifier = Modifier.width(16.dp))

            // Placeholder for symmetry
            Spacer(modifier = Modifier.width(48.dp))
        }
    }
}

private fun formatTime(ms: Long): String {
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
