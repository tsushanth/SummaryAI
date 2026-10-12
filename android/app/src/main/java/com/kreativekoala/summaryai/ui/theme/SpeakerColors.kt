package com.kreativekoala.summaryai.ui.theme

import androidx.compose.ui.graphics.Color

/** Distinct colors (white text stays readable on each) for speaker avatars. */
val SpeakerPalette = listOf(
    Color(0xFF4A4DCB), // indigo
    Color(0xFF0B7A75), // teal
    Color(0xFFB4501A), // burnt orange
    Color(0xFF8E3A9E), // purple
    Color(0xFF2B6CB0), // blue
    Color(0xFFA33A5B), // rose
    Color(0xFF4D7C0F), // olive green
    Color(0xFF6B5B95)  // slate violet
)

/** Stable color for a speaker label: the same label always yields the same color. */
fun speakerColor(label: String?): Color {
    if (label.isNullOrBlank()) return SpeakerPalette[0]
    val idx = (label.hashCode() and Int.MAX_VALUE) % SpeakerPalette.size
    return SpeakerPalette[idx]
}

fun speakerInitials(name: String?): String {
    val parts = name?.trim()?.split(Regex("\\s+"))?.filter { it.isNotEmpty() }.orEmpty()
    return when {
        parts.isEmpty() -> "?"
        parts.size == 1 -> parts[0].take(1).uppercase()
        else -> (parts[0].take(1) + parts[1].take(1)).uppercase()
    }
}
