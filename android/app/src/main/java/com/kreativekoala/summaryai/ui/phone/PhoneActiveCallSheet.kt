package com.kreativekoala.summaryai.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeDown
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.SheetValue
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.domain.model.PhoneCall
import java.util.*


@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ActiveCallSheet(
    call: PhoneCall?,
    callState: ActiveCallState,
    isMuted: Boolean,
    isSpeakerOn: Boolean,
    onToggleMute: () -> Unit,
    onToggleSpeaker: () -> Unit,
    onHangup: () -> Unit,
    onDismiss: () -> Unit
) {
    if (call == null) return

    // Determine if call is still active (not ended/failed)
    val isCallActive = callState in listOf(
        ActiveCallState.INITIATING,
        ActiveCallState.RINGING,
        ActiveCallState.CONNECTED,
        ActiveCallState.RECORDING
    )

    // Create sheet state with skip partially expanded for better UX
    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { sheetValue ->
            // Prevent dismissing by swipe/outside click when call is active
            if (isCallActive) {
                sheetValue != SheetValue.Hidden
            } else {
                true
            }
        }
    )

    ModalBottomSheet(
        onDismissRequest = {
            // Only allow dismiss if call is not active
            if (!isCallActive) {
                onDismiss()
            }
        },
        sheetState = sheetState,
        // Hide drag handle during active call to discourage swiping
        dragHandle = if (isCallActive) {
            { /* No drag handle during active call */ }
        } else null
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Recording indicator - always show when connected (auto-recording)
            if (callState == ActiveCallState.CONNECTED || callState == ActiveCallState.RECORDING) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(bottom = 16.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(12.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.error)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        "Recording",
                        color = MaterialTheme.colorScheme.error,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            // Status with appropriate color for different states
            val statusText = when (callState) {
                ActiveCallState.INITIATING -> "Connecting..."
                ActiveCallState.RINGING -> "Ringing..."
                ActiveCallState.CONNECTED, ActiveCallState.RECORDING -> "Connected - Recording"
                ActiveCallState.ENDED -> "Call Ended"
                ActiveCallState.DECLINED -> "Call Declined"
                ActiveCallState.BUSY -> "Line Busy"
                ActiveCallState.NO_ANSWER -> "No Answer"
                ActiveCallState.ERROR -> "Call Failed"
                else -> ""
            }

            val statusColor = when (callState) {
                ActiveCallState.DECLINED, ActiveCallState.BUSY, ActiveCallState.NO_ANSWER, ActiveCallState.ERROR ->
                    MaterialTheme.colorScheme.error
                ActiveCallState.ENDED -> MaterialTheme.colorScheme.onSurfaceVariant
                else -> MaterialTheme.colorScheme.onSurfaceVariant
            }

            Text(
                text = statusText,
                style = MaterialTheme.typography.bodyMedium,
                color = statusColor,
                fontWeight = if (callState in listOf(ActiveCallState.DECLINED, ActiveCallState.BUSY, ActiveCallState.NO_ANSWER, ActiveCallState.ERROR))
                    FontWeight.Bold else FontWeight.Normal
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Avatar
            Box(
                modifier = Modifier
                    .size(100.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.size(50.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            // Name/number
            Text(
                text = call.toName ?: call.formattedToNumber,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            if (call.toName != null) {
                Text(
                    text = call.formattedToNumber,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Call controls row - Mute, Hangup, Speaker
            Row(
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Mute button
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onToggleMute,
                        containerColor = if (isMuted) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                            contentDescription = if (isMuted) "Unmute" else "Mute",
                            modifier = Modifier.size(24.dp),
                            tint = if (isMuted) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        if (isMuted) "Unmute" else "Mute",
                        style = MaterialTheme.typography.labelSmall
                    )
                }

                // Hangup button
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onHangup,
                        containerColor = MaterialTheme.colorScheme.error,
                        modifier = Modifier.size(72.dp)
                    ) {
                        Icon(
                            Icons.Default.CallEnd,
                            contentDescription = "End Call",
                            modifier = Modifier.size(32.dp),
                            tint = Color.White
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("End Call", style = MaterialTheme.typography.labelSmall)
                }

                // Speaker button
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    FloatingActionButton(
                        onClick = onToggleSpeaker,
                        containerColor = if (isSpeakerOn) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(56.dp)
                    ) {
                        Icon(
                            if (isSpeakerOn) Icons.AutoMirrored.Filled.VolumeUp else Icons.AutoMirrored.Filled.VolumeDown,
                            contentDescription = if (isSpeakerOn) "Speaker Off" else "Speaker On",
                            modifier = Modifier.size(24.dp),
                            tint = if (isSpeakerOn) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        if (isSpeakerOn) "Speaker" else "Speaker",
                        style = MaterialTheme.typography.labelSmall
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}
