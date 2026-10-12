package com.kreativekoala.summaryai.ui.recordings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.Summary
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmEmptyState
import com.kreativekoala.summaryai.ui.components.MmSectionHeader
import com.kreativekoala.summaryai.ui.recordings.share.applyingSpeakerNames

@Composable
internal fun SummaryTab(
    summary: Summary?,
    hasNoSpeech: Boolean = false,
    speakerNames: Map<String, String>? = null,
    analytics: com.kreativekoala.summaryai.data.api.models.MeetingAnalyticsDto? = null,
    headerContent: (@Composable () -> Unit)? = null,
    actionItemsFooter: (@Composable () -> Unit)? = null
) {
    if (summary == null) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            MmEmptyState(
                icon = Icons.Default.AutoAwesome,
                title = stringResource(if (hasNoSpeech) R.string.summary_no_speech else R.string.summary_not_available)
            )
        }
        return
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        if (!hasNoSpeech) headerContent?.invoke()
        if (analytics != null && !hasNoSpeech) {
            TalkTimeCard(analytics)
        }
        // Overview first: it is what people read before anything else
        if (summary.hasKeyPoints) {
            MmCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    MmSectionHeader(
                        title = stringResource(R.string.overview),
                        icon = Icons.Default.AutoAwesome
                    )
                    summary.keyPoints.forEach { point ->
                        Row(verticalAlignment = Alignment.Top) {
                            Box(
                                modifier = Modifier
                                    .padding(top = 8.dp, end = 10.dp)
                                    .size(6.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary)
                            )
                            Text(
                                text = point.applyingSpeakerNames(speakerNames),
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                }
            }
        }

        if (summary.hasActionItems) {
            MmCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    MmSectionHeader(title = stringResource(R.string.ui_action_items), icon = Icons.Default.Checklist)
                    summary.actionItems.forEach { item ->
                        Row(verticalAlignment = Alignment.Top) {
                            Box(
                                modifier = Modifier
                                    .size(22.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                    tint = MaterialTheme.colorScheme.onPrimary
                                )
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                text = item.applyingSpeakerNames(speakerNames),
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                    actionItemsFooter?.invoke()
                }
            }
        }

        val shortText = summary.shortSummary?.takeIf { it.isNotBlank() }
        val detailedText = summary.detailedSummary?.takeIf { it.isNotBlank() }
        if (shortText != null || detailedText != null) {
            val text = (shortText ?: detailedText!!).applyingSpeakerNames(speakerNames)
            MmCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    MmSectionHeader(title = stringResource(R.string.ui_notes), icon = Icons.AutoMirrored.Filled.Notes)
                    Text(text = text, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        if (shortText != null && detailedText != null && detailedText != shortText) {
            MmCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    MmSectionHeader(
                        title = stringResource(R.string.ui_detailed_summary),
                        icon = Icons.Default.AutoAwesome
                    )
                    detailedText.applyingSpeakerNames(speakerNames).split(Regex("\n{2,}")).forEach { para ->
                        Text(text = para.trim(), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
    }
}
