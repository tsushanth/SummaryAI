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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Light color scheme for Meeting Mind
 */
private val LightColorScheme = lightColorScheme(
    primary = BrandIndigo,
    onPrimary = Neutral100,
    primaryContainer = BrandIndigoContainer,
    onPrimaryContainer = Indigo10,
    secondary = Indigo40,
    onSecondary = Neutral100,
    secondaryContainer = BrandIndigoContainer,
    onSecondaryContainer = Indigo10,
    tertiary = Teal40,
    onTertiary = Neutral100,
    tertiaryContainer = Teal90,
    onTertiaryContainer = Teal10,
    error = Red40,
    onError = Neutral100,
    errorContainer = Red90,
    onErrorContainer = Red10,
    background = PaperLight,
    onBackground = Neutral10,
    surface = PaperLight,
    onSurface = Neutral10,
    surfaceVariant = PaperLightHigh,
    onSurfaceVariant = NeutralVariant30,
    surfaceContainerLowest = Neutral100,
    surfaceContainerLow = PaperLight,
    surfaceContainer = PaperLightRaised,
    surfaceContainerHigh = PaperLightHigh,
    surfaceContainerHighest = PaperLightHigh,
    outline = NeutralVariant50,
    outlineVariant = NeutralVariant80,
    inverseSurface = Neutral20,
    inverseOnSurface = Neutral95,
    inversePrimary = BrandLavender,
    surfaceTint = BrandIndigo,
    scrim = Neutral0
)

/**
 * Dark color scheme for Meeting Mind
 */
private val DarkColorScheme = darkColorScheme(
    primary = BrandLavender,
    onPrimary = BrandLavenderDeep,
    primaryContainer = Color(0xFF3A3D99),
    onPrimaryContainer = BrandIndigoContainer,
    secondary = Indigo80,
    onSecondary = Indigo20,
    secondaryContainer = Color(0xFF33367F),
    onSecondaryContainer = BrandIndigoContainer,
    tertiary = Teal80,
    onTertiary = Teal20,
    tertiaryContainer = Teal30,
    onTertiaryContainer = Teal90,
    error = Red80,
    onError = Red20,
    errorContainer = Red30,
    onErrorContainer = Red90,
    background = InkDark,
    onBackground = Color(0xFFE4E3EA),
    surface = InkDark,
    onSurface = Color(0xFFE4E3EA),
    surfaceVariant = InkDarkHigh,
    onSurfaceVariant = NeutralVariant80,
    surfaceContainerLowest = Color(0xFF09090D),
    surfaceContainerLow = InkDark,
    surfaceContainer = InkDarkRaised,
    surfaceContainerHigh = InkDarkHigh,
    surfaceContainerHighest = Color(0xFF2B2B36),
    outline = NeutralVariant60,
    outlineVariant = Color(0xFF34343F),
    inverseSurface = Neutral90,
    inverseOnSurface = Neutral20,
    inversePrimary = BrandIndigo,
    surfaceTint = BrandLavender,
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
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MeetingMindTypography,
        content = content
    )
}
