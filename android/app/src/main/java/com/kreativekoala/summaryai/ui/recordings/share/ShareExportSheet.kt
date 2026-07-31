package com.kreativekoala.summaryai.ui.recordings.share

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Audiotrack
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.TextSnippet
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.data.repository.MeetingsRepository
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.Summary
import com.kreativekoala.summaryai.domain.model.Transcript
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.launch

@EntryPoint
@InstallIn(SingletonComponent::class)
interface ShareExportEntryPoint {
    fun meetingsRepository(): MeetingsRepository
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareExportSheet(
    recording: Recording,
    summary: Summary?,
    transcript: Transcript?,
    onDismiss: () -> Unit,
    onError: (String) -> Unit
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var isGenerating by remember { mutableStateOf(false) }

    val meetingsRepository = remember(context) {
        EntryPointAccessors.fromApplication(
            context.applicationContext, ShareExportEntryPoint::class.java
        ).meetingsRepository()
    }
    val hasMeetingId = !recording.meetingId.isNullOrBlank()

    fun run(type: ShareExporter.ExportType) {
        if (isGenerating) return
        isGenerating = true
        scope.launch {
            val liveStitched = if (
                type == ShareExporter.ExportType.LIVE_TRANSCRIPT_TEXT ||
                type == ShareExporter.ExportType.LIVE_TRANSCRIPT_PDF
            ) {
                recording.meetingId?.let { meetingsRepository.getStitchedLiveTranscript(it).getOrNull() }
            } else null

            val result = ShareExporter.share(
                context = context,
                type = type,
                recording = recording,
                summary = summary,
                transcript = transcript,
                liveTranscript = liveStitched,
            )
            isGenerating = false
            result.onFailure { e -> onError(e.message ?: "Couldn't share.") }
            onDismiss()
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            Text(
                text = "Share or Export",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
            )
            HorizontalDivider()

            ShareRow(
                icon = Icons.Default.PictureAsPdf,
                title = "Share Summary as PDF",
                enabled = summary != null && !isGenerating
            ) { run(ShareExporter.ExportType.SUMMARY_PDF) }

            ShareRow(
                icon = Icons.Default.TextSnippet,
                title = "Share Summary as Text",
                enabled = summary != null && !isGenerating
            ) { run(ShareExporter.ExportType.SUMMARY_TEXT) }

            ShareRow(
                icon = Icons.Default.Description,
                title = "Share Transcript as PDF",
                enabled = transcript != null && !isGenerating
            ) { run(ShareExporter.ExportType.TRANSCRIPT_PDF) }

            ShareRow(
                icon = Icons.Default.TextSnippet,
                title = "Share Transcript as Text",
                enabled = transcript != null && !isGenerating
            ) { run(ShareExporter.ExportType.TRANSCRIPT_TEXT) }

            if (hasMeetingId) {
                ShareRow(
                    icon = Icons.Default.TextSnippet,
                    title = "Share Live Transcript as Text",
                    enabled = !isGenerating
                ) { run(ShareExporter.ExportType.LIVE_TRANSCRIPT_TEXT) }

                ShareRow(
                    icon = Icons.Default.Description,
                    title = "Share Live Transcript as PDF",
                    enabled = !isGenerating
                ) { run(ShareExporter.ExportType.LIVE_TRANSCRIPT_PDF) }
            }

            ShareRow(
                icon = Icons.Default.Audiotrack,
                title = "Share Audio",
                enabled = recording.audioUrl != null && !isGenerating
            ) { run(ShareExporter.ExportType.AUDIO) }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Icon(
                    Icons.Default.Lightbulb,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.tertiary
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    "Share or export with just a tap!",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (isGenerating) {
                Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
        }
    }
}

@Composable
private fun ShareRow(
    icon: ImageVector,
    title: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .let { if (enabled) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Box(
            Modifier.size(40.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                icon,
                contentDescription = null,
                tint = if (enabled) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
            )
        }
        Spacer(Modifier.width(16.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            color = if (enabled) MaterialTheme.colorScheme.onSurface
            else MaterialTheme.colorScheme.onSurface.copy(alpha = 0.4f)
        )
    }
}
