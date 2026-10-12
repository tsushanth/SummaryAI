package com.kreativekoala.summaryai.ui.recordings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.MeetingAnalyticsDto
import kotlin.math.roundToInt

/** Per-speaker talk share, question count and longest monologue for a finished meeting. */
@Composable
fun TalkTimeCard(analytics: MeetingAnalyticsDto, modifier: Modifier = Modifier) {
    if (analytics.speakers.isEmpty()) return
    Card(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = stringResource(R.string.analytics_title),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            analytics.speakers.forEach { s ->
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(s.name, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "${(s.talkShare * 100).roundToInt()}%",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    LinearProgressIndicator(
                        progress = { s.talkShare.toFloat().coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth()
                    )
                    Text(
                        text = stringResource(R.string.analytics_words, s.wordCount) + "  ·  " +
                            stringResource(R.string.analytics_questions, s.questionCount),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            val speaker = analytics.longestMonologueSpeaker
            if (speaker != null && analytics.longestMonologueSeconds > 0) {
                Text(
                    text = stringResource(
                        R.string.analytics_longest_monologue,
                        speaker,
                        formatDuration(analytics.longestMonologueSeconds)
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

private fun formatDuration(seconds: Double): String {
    val total = seconds.roundToInt()
    return if (total >= 60) "${total / 60}m ${total % 60}s" else "${total}s"
}
