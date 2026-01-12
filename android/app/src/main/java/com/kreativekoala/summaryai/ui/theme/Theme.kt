package com.kreativekoala.summaryai.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Light color scheme for Meeting Mind
 */
private val LightColorScheme = lightColorScheme(
    // Primary
    primary = Blue40,
    onPrimary = Neutral100,
    primaryContainer = Blue90,
    onPrimaryContainer = Blue10,

    // Secondary
    secondary = Indigo40,
    onSecondary = Neutral100,
    secondaryContainer = Indigo90,
    onSecondaryContainer = Indigo10,

    // Tertiary
    tertiary = Teal40,
    onTertiary = Neutral100,
    tertiaryContainer = Teal90,
    onTertiaryContainer = Teal10,

    // Error
    error = Red40,
    onError = Neutral100,
    errorContainer = Red90,
    onErrorContainer = Red10,

    // Background & Surface
    background = Neutral99,
    onBackground = Neutral10,
    surface = Neutral99,
    onSurface = Neutral10,
    surfaceVariant = NeutralVariant90,
    onSurfaceVariant = NeutralVariant30,

    // Outline
    outline = NeutralVariant50,
    outlineVariant = NeutralVariant80,

    // Inverse
    inverseSurface = Neutral20,
    inverseOnSurface = Neutral95,
    inversePrimary = Blue80,

    // Surface tint
    surfaceTint = Blue40,

    // Scrim
    scrim = Neutral0
)

/**
 * Dark color scheme for Meeting Mind
 */
private val DarkColorScheme = darkColorScheme(
    // Primary
    primary = Blue80,
    onPrimary = Blue20,
    primaryContainer = Blue30,
    onPrimaryContainer = Blue90,

    // Secondary
    secondary = Indigo80,
    onSecondary = Indigo20,
    secondaryContainer = Indigo30,
    onSecondaryContainer = Indigo90,

    // Tertiary
    tertiary = Teal80,
    onTertiary = Teal20,
    tertiaryContainer = Teal30,
    onTertiaryContainer = Teal90,

    // Error
    error = Red80,
    onError = Red20,
    errorContainer = Red30,
    onErrorContainer = Red90,

    // Background & Surface
    background = Neutral10,
    onBackground = Neutral90,
    surface = Neutral10,
    onSurface = Neutral90,
    surfaceVariant = NeutralVariant30,
    onSurfaceVariant = NeutralVariant80,

    // Outline
    outline = NeutralVariant60,
    outlineVariant = NeutralVariant30,

    // Inverse
    inverseSurface = Neutral90,
    inverseOnSurface = Neutral20,
    inversePrimary = Blue40,

    // Surface tint
    surfaceTint = Blue80,

    // Scrim
    scrim = Neutral0
)

/**
 * Meeting Mind Theme
 * Follows system light/dark mode setting
 * Set dynamicColor to true to use Android 12+ Material You colors
 */
@Composable
fun MeetingMindTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false, // Disabled for consistent appearance across devices
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MeetingMindTypography,
        content = content
    )
}
