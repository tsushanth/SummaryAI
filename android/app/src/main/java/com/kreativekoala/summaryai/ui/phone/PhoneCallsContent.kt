package com.kreativekoala.summaryai.ui.phone

import android.Manifest
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.SheetValue
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.kreativekoala.summaryai.domain.model.PhoneCall
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.VerifiedPhone
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
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
    } else if (calls.isEmpty()) {
        EmptyCallsContent()
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
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
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                if (onCallClick != null) {
                    Modifier.clickable { onCallClick(call) }
                } else {
                    Modifier
                }
            ),
        shape = RoundedCornerShape(12.dp)
    ) {
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
                        when (call.status) {
                            PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50).copy(alpha = 0.15f)
                            PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3).copy(alpha = 0.15f)
                            PhoneCallStatus.RINGING -> Color(0xFFFF9800).copy(alpha = 0.15f)
                            PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336).copy(alpha = 0.15f)
                            else -> MaterialTheme.colorScheme.surfaceVariant
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = when (call.status) {
                        PhoneCallStatus.COMPLETED -> Icons.Default.PhoneCallback
                        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Icons.Default.Phone
                        PhoneCallStatus.RINGING -> Icons.Default.PhoneInTalk
                        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Icons.Default.PhoneMissed
                        else -> Icons.Default.Phone
                    },
                    contentDescription = null,
                    tint = when (call.status) {
                        PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50)
                        PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3)
                        PhoneCallStatus.RINGING -> Color(0xFFFF9800)
                        PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336)
                        else -> MaterialTheme.colorScheme.onSurfaceVariant
                    }
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
                        color = when (call.status) {
                            PhoneCallStatus.COMPLETED -> Color(0xFF4CAF50)
                            PhoneCallStatus.IN_PROGRESS, PhoneCallStatus.RECORDING -> Color(0xFF2196F3)
                            PhoneCallStatus.RINGING -> Color(0xFFFF9800)
                            PhoneCallStatus.FAILED, PhoneCallStatus.BUSY, PhoneCallStatus.NO_ANSWER -> Color(0xFFF44336)
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        }
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
                                    .background(Color.Red)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "Recording",
                                style = MaterialTheme.typography.bodySmall,
                                color = Color.Red
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
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Icon(
            Icons.Default.Phone,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "No calls yet",
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Medium
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Make a call using the dialer to get started",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )
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
