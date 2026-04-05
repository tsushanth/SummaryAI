package com.kreativekoala.summaryai

import android.os.Bundle
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
import androidx.compose.ui.graphics.Color
import com.kreativekoala.summaryai.data.preferences.AppOpenTracker
import com.kreativekoala.summaryai.data.preferences.ThemeMode
import com.kreativekoala.summaryai.data.preferences.ThemePreferences
import com.kreativekoala.summaryai.service.AuthService
import com.kreativekoala.summaryai.service.FirebaseAnalyticsHelper
import com.kreativekoala.summaryai.service.TikTokHelper
import com.kreativekoala.summaryai.ui.navigation.MeetingMindNavGraph
import com.kreativekoala.summaryai.ui.theme.MeetingMindTheme
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallView
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback
import com.revenuecat.purchases.models.StoreProduct
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.restorePurchasesWith
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Main Activity - Single activity architecture with Compose Navigation
 */
@AndroidEntryPoint
class MainActivity : AppCompatActivity() {

    @Inject
    lateinit var authService: AuthService

    @Inject
    lateinit var themePreferences: ThemePreferences

    @Inject
    lateinit var appOpenTracker: AppOpenTracker

    private var showPaywall by mutableStateOf(false)
    private var isPremiumUser by mutableStateOf(false)
    private var paywallDismissed by mutableStateOf(false)
    private var rcProducts by mutableStateOf<List<Pair<com.revenuecat.purchases.Package, StoreProduct>>>(emptyList())
    private var productsLoaded by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Increment app open count once per session (cold start)
        val openCount = appOpenTracker.incrementAndGetCount()
        Log.d("MainActivity", "App open count: $openCount (limit: ${AppOpenTracker.FREE_OPEN_LIMIT})")

        // Check subscription status to decide whether to show paywall
        checkSubscriptionAndGate(openCount)

        // Load RevenueCat offerings for PaywallKit
        loadOfferings()

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
                    // Show PaywallKit soft paywall if user exceeded free limit and is not premium
                    if (showPaywall && !isPremiumUser && !paywallDismissed) {
                        if (!productsLoaded) {
                            // Wait for products to load
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(Color(0xFF0A0A0F)),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator(color = Color(0xFF6C63FF))
                            }
                        } else {
                            // Map RevenueCat products to PaywallKit products
                            val paywallProducts = rcProducts.map { (pkg, product) ->
                                PaywallProduct(
                                    id = product.id,
                                    localizedPrice = product.price.formatted,
                                    price = product.price.amountMicros / 1_000_000.0,
                                    currencyCode = product.price.currencyCode,
                                    trialDays = 3,
                                    period = when {
                                        pkg.packageType.name.contains("WEEKLY", ignoreCase = true) -> PaywallProduct.Period.WEEKLY
                                        pkg.packageType.name.contains("MONTHLY", ignoreCase = true) -> PaywallProduct.Period.MONTHLY
                                        pkg.packageType.name.contains("ANNUAL", ignoreCase = true) -> PaywallProduct.Period.YEARLY
                                        else -> PaywallProduct.Period.MONTHLY
                                    }
                                )
                            }

                            val features = listOf(
                                PaywallFeature("\uD83C\uDF99\uFE0F", "Unlimited Recordings", "Record every meeting"),
                                PaywallFeature("\uD83D\uDCDD", "AI Summaries", "Automatic meeting notes"),
                                PaywallFeature("\uD83D\uDD0D", "Smart Search", "Find any moment"),
                                PaywallFeature("\uD83D\uDCE4", "Export", "Share notes anywhere"),
                                PaywallFeature("\u2601\uFE0F", "Cloud Storage", "Unlimited storage")
                            )

                            PaywallView(
                                appId = "meetingmind",
                                appName = "MeetingMind",
                                features = features,
                                products = paywallProducts,
                                theme = PaywallTheme(
                                    accent = Color(0xFF6C63FF),
                                    accent2 = Color(0xFF9C27B0)
                                ),
                                showWinback = true,
                                isDismissible = true,
                                onPurchase = { productId ->
                                    val match = rcProducts.firstOrNull { it.second.id == productId }
                                    if (match != null) {
                                        Purchases.sharedInstance.purchaseWith(
                                            PurchaseParams.Builder(this@MainActivity, match.first).build(),
                                            onError = { error, userCancelled ->
                                                Log.e("MainActivity", "Purchase failed: ${error.message}, cancelled: $userCancelled")
                                            },
                                            onSuccess = { _, customerInfo ->
                                                val hasPremium = customerInfo.entitlements["premium"]?.isActive == true
                                                if (hasPremium) {
                                                    isPremiumUser = true
                                                    showPaywall = false
                                                }
                                                // Track purchase events for ad attribution
                                                val price = match.second.price.amountMicros / 1_000_000.0
                                                FirebaseAnalyticsHelper.logPurchaseCompleted(productId, price)
                                                TikTokHelper.trackEvent("purchase_success")
                                            }
                                        )
                                    }
                                },
                                onRestore = {
                                    Purchases.sharedInstance.restorePurchasesWith(
                                        onError = { error ->
                                            Log.e("MainActivity", "Restore failed: ${error.message}")
                                        },
                                        onSuccess = { customerInfo ->
                                            val hasPremium = customerInfo.entitlements["premium"]?.isActive == true
                                            if (hasPremium) {
                                                isPremiumUser = true
                                                showPaywall = false
                                            }
                                        }
                                    )
                                },
                                onDismiss = {
                                    paywallDismissed = true
                                }
                            )
                        }
                    } else {
                        val authState by authService.authState.collectAsState()

                        if (authState.isLoading) {
                            // Show loading while auth state is being restored from DataStore
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
                                hasCompletedOnboarding = authState.hasCompletedOnboarding
                            )
                        }
                    }
                }
            }
        }
    }

    private fun checkSubscriptionAndGate(openCount: Int) {
        Purchases.sharedInstance.getCustomerInfo(object : ReceiveCustomerInfoCallback {
            override fun onReceived(customerInfo: CustomerInfo) {
                val hasPremium = customerInfo.entitlements["premium"]?.isActive == true
                isPremiumUser = hasPremium
                showPaywall = !hasPremium && openCount > AppOpenTracker.FREE_OPEN_LIMIT
                Log.d("MainActivity", "Premium: $hasPremium, showPaywall: $showPaywall")
            }

            override fun onError(error: PurchasesError) {
                Log.e("MainActivity", "Failed to check subscription: ${error.message}")
                // On error, still gate if over limit (fail safe)
                showPaywall = openCount > AppOpenTracker.FREE_OPEN_LIMIT
            }
        })
    }

    private fun loadOfferings() {
        Purchases.sharedInstance.getOfferingsWith(
            onError = { error ->
                Log.e("MainActivity", "Failed to load offerings: ${error.message}")
                productsLoaded = true // Mark loaded even on error so UI doesn't hang
            },
            onSuccess = { offerings ->
                val packages = offerings.current?.availablePackages ?: emptyList()
                rcProducts = packages.map { pkg -> pkg to pkg.product }
                productsLoaded = true
                Log.d("MainActivity", "Loaded ${rcProducts.size} products for PaywallKit")
            }
        )
    }
}
