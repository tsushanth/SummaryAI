package com.kreativekoala.summaryai.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Live waveform visualization for audio recording
 */
@Composable
fun LiveWaveform(
    amplitudes: List<Float>,
    modifier: Modifier = Modifier,
    barCount: Int = 40,
    barWidth: Dp = 4.dp,
    barSpacing: Dp = 2.dp,
    minBarHeight: Dp = 4.dp,
    maxBarHeight: Dp = 80.dp,
    color: Color = MaterialTheme.colorScheme.primary
) {
    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(maxBarHeight)
    ) {
        val totalBarWidth = barWidth.toPx() + barSpacing.toPx()
        val startX = (size.width - (barCount * totalBarWidth - barSpacing.toPx())) / 2
        val centerY = size.height / 2
        val minHeight = minBarHeight.toPx()
        val maxHeight = maxBarHeight.toPx()

        // Calculate which amplitudes to use based on bar count
        val step = if (amplitudes.size >= barCount) {
            amplitudes.size / barCount
        } else {
            1
        }

        for (i in 0 until barCount) {
            val amplitudeIndex = if (amplitudes.isNotEmpty()) {
                (i * step).coerceIn(0, amplitudes.size - 1)
            } else {
                -1
            }

            val amplitude = if (amplitudeIndex >= 0 && amplitudeIndex < amplitudes.size) {
                amplitudes[amplitudeIndex]
            } else {
                0f
            }

            // Add some randomness for visual appeal when no data
            val displayAmplitude = if (amplitude == 0f && amplitudes.isEmpty()) {
                0.1f + (Math.random().toFloat() * 0.1f)
            } else {
                amplitude.coerceIn(0.1f, 1f)
            }

            val barHeight = minHeight + (displayAmplitude * (maxHeight - minHeight))
            val x = startX + (i * totalBarWidth)
            val y = centerY - (barHeight / 2)

            drawRoundRect(
                color = color.copy(alpha = 0.3f + (displayAmplitude * 0.7f)),
                topLeft = Offset(x, y),
                size = Size(barWidth.toPx(), barHeight),
                cornerRadius = CornerRadius(barWidth.toPx() / 2)
            )
        }
    }
}

/**
 * Static waveform for playback visualization
 */
@Composable
fun StaticWaveform(
    progress: Float,
    modifier: Modifier = Modifier,
    barCount: Int = 60,
    barWidth: Dp = 3.dp,
    barSpacing: Dp = 1.dp,
    maxBarHeight: Dp = 48.dp,
    activeColor: Color = MaterialTheme.colorScheme.primary,
    inactiveColor: Color = MaterialTheme.colorScheme.surfaceVariant,
    waveformData: List<Float>? = null
) {
    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .height(maxBarHeight)
    ) {
        val totalBarWidth = barWidth.toPx() + barSpacing.toPx()
        val centerY = size.height / 2
        val maxHeight = maxBarHeight.toPx()

        // Generate pseudo-random waveform if no data provided
        val bars = waveformData ?: List(barCount) { i ->
            val base = 0.3f + (kotlin.math.sin(i * 0.5).toFloat() + 1) * 0.35f
            base * (0.8f + kotlin.math.cos(i * 0.3).toFloat() * 0.2f)
        }

        for (i in 0 until barCount) {
            val barProgress = i.toFloat() / barCount
            val isActive = barProgress <= progress

            val amplitude = bars.getOrElse(i) { 0.5f }
            val barHeight = amplitude * maxHeight
            val x = i * totalBarWidth
            val y = centerY - (barHeight / 2)

            drawRoundRect(
                color = if (isActive) activeColor else inactiveColor,
                topLeft = Offset(x, y),
                size = Size(barWidth.toPx(), barHeight),
                cornerRadius = CornerRadius(barWidth.toPx() / 2)
            )
        }
    }
}
