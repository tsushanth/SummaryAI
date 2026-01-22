package com.kreativekoala.summaryai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.kreativekoala.summaryai.data.preferences.ThemeMode
import com.kreativekoala.summaryai.data.preferences.ThemePreferences
import com.kreativekoala.summaryai.service.AuthService
import com.kreativekoala.summaryai.ui.navigation.MeetingMindNavGraph
import com.kreativekoala.summaryai.ui.theme.MeetingMindTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Main Activity - Single activity architecture with Compose Navigation
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authService: AuthService

    @Inject
    lateinit var themePreferences: ThemePreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            val themeMode by themePreferences.themeMode.collectAsState(initial = ThemeMode.LIGHT)
            val isDarkTheme = when (themeMode) {
                ThemeMode.LIGHT -> false
                ThemeMode.DARK -> true
                ThemeMode.SYSTEM -> isSystemInDarkTheme()
            }

            MeetingMindTheme(darkTheme = isDarkTheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val authState by authService.authState.collectAsState()

                    MeetingMindNavGraph(
                        isAuthenticated = authState.isAuthenticated,
                        hasCompletedOnboarding = authState.hasCompletedOnboarding,
                        hasSkippedSignIn = authState.hasSkippedSignIn
                    )
                }
            }
        }
    }
}
