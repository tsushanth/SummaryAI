package com.kreativekoala.summaryai.ui.coaching

import com.kreativekoala.summaryai.R
import androidx.annotation.StringRes
import androidx.compose.ui.res.stringResource
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.data.api.coaching.CoachingInsight

/** Why the coach is not (or no longer) giving tips, in the user's words. */
@StringRes
fun coachingStatusText(state: CoachingState): Int? = when (state.phase) {
    CoachingPhase.IDLE, CoachingPhase.LIVE -> null
    CoachingPhase.STARTING -> R.string.coach_starting
    CoachingPhase.RECONNECTING -> R.string.coach_reconnecting
    CoachingPhase.NOT_STARTED -> when (state.startFailure) {
        CoachingStartFailure.NO_CREDITS -> R.string.coach_error_no_credits
        CoachingStartFailure.MEETING_OVER -> R.string.coach_error_meeting_over
        else -> R.string.coach_error_generic
    }
    CoachingPhase.ENDED -> when (state.endReason) {
        "bot_not_admitted" -> R.string.coach_ended_not_admitted
        "bot_failed" -> R.string.coach_ended_bot_failed
        "no_speech" -> R.string.coach_ended_no_speech
        "model_failed" -> R.string.coach_ended_model_failed
        else -> R.string.coach_ended
    }
}

/** What happened to the session credit, when that is worth saying. */
@StringRes
fun coachingCreditText(state: CoachingState): Int? = when {
    state.phase == CoachingPhase.ENDED && state.refunded -> R.string.coach_credit_returned
    state.phase == CoachingPhase.NOT_STARTED && state.startFailure == CoachingStartFailure.MEETING_OVER -> R.string.coach_no_credit_used
    else -> null
}

/**
 * Live tips panel for a meeting with AI Coach on. Mirrors iOS `CoachingLivePanel`. Color codes by urgency
 * (now/soon/before-end). Always says what the coach is doing, and why when it stops.
 */
@Composable
fun CoachingLivePanel(
    state: CoachingState,
    onStop: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var collapsed by remember { mutableStateOf(false) }
    val accent = Color(0xFF8B5CF6)
    val insights = state.insights
    val running = state.phase == CoachingPhase.LIVE || state.phase == CoachingPhase.RECONNECTING

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, accent.copy(alpha = 0.3f), RoundedCornerShape(14.dp))
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = accent)
            Spacer(Modifier.width(8.dp))
            Text(stringResource(R.string.ui_ai_coach), style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.width(8.dp))
            if (state.phase == CoachingPhase.LIVE) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(Color(0xFF22C55E)))
            }
            Spacer(Modifier.weight(1f))
            if (running) {
                TextButton(onClick = onStop) { Text(stringResource(R.string.coach_stop)) }
            }
            IconButton(onClick = { collapsed = !collapsed }) {
                Icon(
                    if (collapsed) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                    contentDescription = if (collapsed) "Expand" else "Collapse",
                )
            }
        }

        AnimatedVisibility(visible = !collapsed) {
            Column {
                HorizontalDivider()
                val status = coachingStatusText(state)
                val credit = coachingCreditText(state)
                if (status != null) {
                    Text(
                        stringResource(status),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                if (credit != null) {
                    Text(
                        stringResource(credit),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp),
                    )
                }
                if (state.phase == CoachingPhase.NOT_STARTED && state.startFailure == CoachingStartFailure.OTHER) {
                    TextButton(onClick = onRetry, modifier = Modifier.padding(horizontal = 8.dp)) {
                        Text(stringResource(R.string.retry))
                    }
                }
                if (insights.isEmpty()) {
                    if (state.phase == CoachingPhase.LIVE) {
                        Column(Modifier.padding(16.dp)) {
                            Text(
                                stringResource(R.string.ui_listening_for_tactical_moments),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                stringResource(R.string.coach_listening_hint),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 260.dp)
                            .padding(12.dp),
                    ) {
                        items(insights, key = { it.id }) { insight ->
                            CoachingInsightRow(insight)
                            Spacer(Modifier.height(10.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CoachingInsightRow(insight: CoachingInsight) {
    val color = when (insight.urgency) {
        "now" -> Color(0xFFEF4444)
        "soon" -> Color(0xFFF59E0B)
        else -> Color(0xFF22C55E)
    }
    Row(verticalAlignment = Alignment.Top) {
        Box(
            Modifier.padding(top = 6.dp).size(8.dp).clip(CircleShape).background(color)
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(insight.text, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(2.dp))
            Row {
                Text(
                    insight.type.replaceFirstChar { it.uppercase() },
                    style = MaterialTheme.typography.labelSmall,
                    color = color,
                )
                insight.transcriptOffsetSeconds?.let {
                    Text(
                        " · ${it / 60}:${"%02d".format(it % 60)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
