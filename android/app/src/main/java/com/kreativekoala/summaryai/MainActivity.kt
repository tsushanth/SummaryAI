package com.kreativekoala.summaryai

import android.os.Bundle
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import android.util.Log
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.lifecycleScope
import com.kreativekoala.summaryai.data.preferences.AppOpenTracker
import com.kreativekoala.summaryai.data.preferences.ThemeMode
import com.kreativekoala.summaryai.data.preferences.ThemePreferences
import com.kreativekoala.summaryai.service.AuthService
import com.kreativekoala.summaryai.service.BillingManager
import com.kreativekoala.summaryai.ui.navigation.MeetingMindNavGraph
import com.kreativekoala.summaryai.ui.theme.MeetingMindTheme
import com.kreativekoala.ratingkit.RatingKit
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    @Inject lateinit var authService: AuthService
    @Inject lateinit var themePreferences: ThemePreferences
    @Inject lateinit var appOpenTracker: AppOpenTracker
    @Inject lateinit var billingManager: BillingManager

    private var showPaywall by mutableStateOf(false)

    override fun onResume() {
        super.onResume()
        // Show Play billing in-app messages (subscription management, lapsed sub recovery)
        billingManager.showInAppMessages(this)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PromoCodeManager.handleIntent(intent)
        enableEdgeToEdge()

        val openCount = appOpenTracker.incrementAndGetCount()
        Log.d("MainActivity", "App open count: $openCount (limit: ${AppOpenTracker.FREE_OPEN_LIMIT})")

        // RatingKit — fires Play In-App Review prompt after sustained engagement.
        RatingKit.trackAppOpen(this)

        // Initialize billing (connects to Play Billing, loads products, checks existing purchases)
        billingManager.initialize()

        // Gate based on open count + subscription status
        lifecycleScope.launch {
            billingManager.isSubscribed.collect { subscribed ->
                showPaywall = !subscribed && openCount > AppOpenTracker.FREE_OPEN_LIMIT
            }
        }

        // Fire RatingKit's "purchase peak" whenever a subscription transitions
        // to active during this session. StateFlow already de-dupes consecutive
        // values; skipping the first emission avoids re-firing on cold start
        // for already-subscribed users.
        lifecycleScope.launch {
            var first = true
            billingManager.isSubscribed.collect { subscribed ->
                if (subscribed && !first) {
                    RatingKit.trackPurchase(this@MainActivity)
                }
                first = false
            }
        }

        setContent {
            val themeMode by themePreferences.themeMode.collectAsState(initial = ThemeMode.LIGHT)
            val isDarkTheme = when (themeMode) {
                ThemeMode.LIGHT -> false
                ThemeMode.DARK -> true
                ThemeMode.SYSTEM -> isSystemInDarkTheme()
            }
            val isSubscribed by billingManager.isSubscribed.collectAsState()
            val products by billingManager.products.collectAsState()

            MeetingMindTheme(darkTheme = isDarkTheme) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val authState by authService.authState.collectAsState()

                    if (authState.isLoading) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(MaterialTheme.colorScheme.background),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    } else {
                        MeetingMindNavGraph(
                            isAuthenticated = authState.isAuthenticated,
                            hasCompletedOnboarding = authState.hasCompletedOnboarding,
                            showPaywall = showPaywall && !isSubscribed,
                            // Live check: re-evaluated at every gated action call site.
                            // Reads SharedPreferences (open count) + StateFlow (subscription).
                            shouldHardGate = {
                                !billingManager.isSubscribed.value &&
                                        appOpenTracker.hasExceededFreeLimit()
                            }
                        )
                    }
                }
            }
        }
    }
}
