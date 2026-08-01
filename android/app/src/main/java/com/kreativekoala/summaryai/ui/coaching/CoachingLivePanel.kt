package com.kreativekoala.summaryai.ui.coaching

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

/**
 * Live insights panel shown during recording when AI Coach is on. Mirrors
 * iOS `CoachingLivePanel`. Color codes by urgency (now/soon/before-end).
 */
@Composable
fun CoachingLivePanel(
    insights: List<CoachingInsight>,
    isActive: Boolean,
    modifier: Modifier = Modifier,
) {
    var collapsed by remember { mutableStateOf(false) }
    val accent = Color(0xFF8B5CF6)

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
            Text("AI Coach", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.width(8.dp))
            if (isActive) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(Color(0xFF22C55E)))
            }
            Spacer(Modifier.weight(1f))
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
                if (insights.isEmpty()) {
                    Text(
                        "Listening for tactical moments…",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
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
