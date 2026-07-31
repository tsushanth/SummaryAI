package com.kreativekoala.summaryai.ui.coaching

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.data.api.coaching.CoachingPersonaKey

/**
 * Pre-meeting AI Coach toggle. Mirrors iOS `CoachingToggleCard`. Shown above
 * the record button on the recording screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CoachingToggleCard(
    enabled: Boolean,
    onEnabledChange: (Boolean) -> Unit,
    persona: CoachingPersonaKey,
    onPersonaChange: (CoachingPersonaKey) -> Unit,
    creditBalance: Int,
    isLoadingBalance: Boolean,
    onGetMoreCredits: () -> Unit,
) {
    val accent = Color(0xFF8B5CF6)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(
                width = 1.dp,
                color = if (enabled) accent.copy(alpha = 0.4f) else Color.Transparent,
                shape = RoundedCornerShape(12.dp)
            )
            .padding(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = accent)
            Spacer(Modifier.width(8.dp))
            Text("AI Coach", style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.weight(1f))
            Switch(
                checked = enabled,
                onCheckedChange = onEnabledChange,
                enabled = creditBalance > 0,
                colors = SwitchDefaults.colors(checkedThumbColor = accent, checkedTrackColor = accent.copy(alpha = 0.5f))
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            var expanded by remember { mutableStateOf(false) }
            Box {
                TextButton(onClick = { expanded = true }, contentPadding = PaddingValues(horizontal = 4.dp)) {
                    Text(persona.displayName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.Default.ExpandMore, contentDescription = null, modifier = Modifier.size(14.dp))
                }
                DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                    CoachingPersonaKey.entries.forEach { p ->
                        DropdownMenuItem(
                            text = { Text(p.displayName) },
                            onClick = { onPersonaChange(p); expanded = false }
                        )
                    }
                }
            }
            Spacer(Modifier.weight(1f))
            when {
                isLoadingBalance -> CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                creditBalance > 0 -> Text(
                    "$creditBalance credit${if (creditBalance == 1) "" else "s"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                else -> TextButton(onClick = onGetMoreCredits) {
                    Text("Get credits", style = MaterialTheme.typography.bodySmall, color = accent)
                }
            }
        }
    }
}
