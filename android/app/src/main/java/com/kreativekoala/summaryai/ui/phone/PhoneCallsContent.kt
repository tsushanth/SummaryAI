package com.kreativekoala.summaryai.ui.phone

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PhoneCallback
import androidx.compose.material.icons.automirrored.filled.PhoneMissed
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmEmptyState
import com.kreativekoala.summaryai.ui.components.SkeletonCardList
import java.text.SimpleDateFormat
import java.util.*


@Composable
internal fun CallsContent(
    calls: List<PhoneCall>,
    isLoading: Boolean,
    isRefreshing: Boolean,
    hasVerifiedPhone: Boolean,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onRecordingClick: (String) -> Unit,
    onCallClick: (PhoneCall) -> Unit
) {
    if (isLoading && calls.isEmpty()) {
        SkeletonCardList(count = 5, loadingDescription = "Loading calls")
    } else if (calls.isEmpty()) {
        EmptyCallsContent()
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(calls) { call ->
                PhoneCallCard(
                    call = call,
                    onRecordingClick = onRecordingClick,
                    onCallClick = if (hasVerifiedPhone) onCallClick else null
                )
            }

            item {
                LaunchedEffect(Unit) {
                    onLoadMore()
                }
            }
        }
    }
}

@Composable
internal fun PhoneCallCard(
    call: PhoneCall,
    onRecordingClick: (String) -> Unit,
    onCallClick: ((PhoneCall) -> Unit)? = null
) {
    val accent = callStatusColor(call.status)
    MmCard(onClick = onCallClick?.let { cb -> { cb(call) } }) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status icon
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .background(
                        accent.copy(alpha = 0.15f)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = when (call.status) {
                        PhoneCallStatus.COMPLETED -> Icons.AutoMirrored.Filled.PhoneCallback
                        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Icons.Default.Phone
                        PhoneCallStatus.RINGING -> Icons.Default.PhoneInTalk
                        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Icons.AutoMirrored.Filled.PhoneMissed
                        else -> Icons.Default.Phone
                    },
                    contentDescription = null,
                    tint = accent
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            // Call info
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = call.toName ?: call.formattedToNumber,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = call.status.displayName,
                        style = MaterialTheme.typography.bodySmall,
                        color = accent
                    )

                    call.recordingDuration?.let {
                        Text(
                            text = "• ${call.formattedDuration}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }

                    if (call.isRecording) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.error)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "Recording",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            }

            // Timestamp and recording link
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = formatCallDate(call.startedAt ?: call.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                call.recordingId?.let { recordingId ->
                    TextButton(
                        onClick = { onRecordingClick(recordingId) },
                        contentPadding = PaddingValues(0.dp)
                    ) {
                        Icon(
                            Icons.Default.GraphicEq,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Recording", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }

            // Show call button if callback available
            if (onCallClick != null) {
                Spacer(modifier = Modifier.width(8.dp))
                IconButton(
                    onClick = { onCallClick(call) }
                ) {
                    Icon(
                        Icons.Default.Phone,
                        contentDescription = "Call",
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}

@Composable
internal fun EmptyCallsContent() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        MmEmptyState(
            icon = Icons.Default.Phone,
            title = "No calls yet",
            message = "Make a call using the dialer to get started"
        )
    }
}

/** Status accent with enough contrast on both light and dark surfaces. */
@Composable
internal fun callStatusColor(status: PhoneCallStatus): Color {
    val dark = isSystemInDarkTheme()
    return when (status) {
        PhoneCallStatus.COMPLETED -> if (dark) Color(0xFF66BB6A) else Color(0xFF2E7D32)
        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> if (dark) Color(0xFF64B5F6) else Color(0xFF1565C0)
        PhoneCallStatus.RINGING -> if (dark) Color(0xFFFFB74D) else Color(0xFFB45309)
        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> MaterialTheme.colorScheme.error
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
}

internal fun formatCallDate(dateString: String): String {
    return try {
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault())
        val date = parser.parse(dateString) ?: return dateString

        val now = Calendar.getInstance()
        val callDate = Calendar.getInstance().apply { time = date }

        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
        val dateFormat = SimpleDateFormat("MMM d", Locale.getDefault())

        when {
            now.get(Calendar.DAY_OF_YEAR) == callDate.get(Calendar.DAY_OF_YEAR) &&
            now.get(Calendar.YEAR) == callDate.get(Calendar.YEAR) -> {
                "Today ${timeFormat.format(date)}"
            }
            now.get(Calendar.DAY_OF_YEAR) - 1 == callDate.get(Calendar.DAY_OF_YEAR) &&
            now.get(Calendar.YEAR) == callDate.get(Calendar.YEAR) -> {
                "Yesterday ${timeFormat.format(date)}"
            }
            else -> {
                "${dateFormat.format(date)} ${timeFormat.format(date)}"
            }
        }
    } catch (e: Exception) {
        dateString
    }
}
