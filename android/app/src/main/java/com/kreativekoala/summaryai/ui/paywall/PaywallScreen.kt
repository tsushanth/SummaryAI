package com.kreativekoala.summaryai.ui.paywall

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallView

/**
 * Paywall screen - uses PaywallKit with native templates.
 */
@Composable
fun PaywallScreen(
    onNavigateBack: () -> Unit,
    onPurchaseSuccess: () -> Unit,
    viewModel: PaywallViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val activity = LocalContext.current as? Activity

    // If already subscribed, navigate back
    LaunchedEffect(uiState.purchaseSuccess) {
        if (uiState.purchaseSuccess) {
            onPurchaseSuccess()
        }
    }

    val offering = uiState.offering
    if (offering == null || uiState.isLoading) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0A0A0F)),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = Color(0xFF6C63FF))
        }
        return
    }

    val paywallProducts = offering.availablePackages.map { pkg ->
        PaywallProduct(
            id = pkg.product.id,
            localizedPrice = pkg.product.price.formatted,
            price = pkg.product.price.amountMicros / 1_000_000.0,
            currencyCode = pkg.product.price.currencyCode,
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
            if (activity != null) {
                val pkg = offering.availablePackages.firstOrNull { it.product.id == productId }
                if (pkg != null) {
                    viewModel.selectPlan(
                        when {
                            pkg.packageType.name.contains("WEEKLY", ignoreCase = true) -> "weekly"
                            pkg.packageType.name.contains("MONTHLY", ignoreCase = true) -> "monthly"
                            pkg.packageType.name.contains("ANNUAL", ignoreCase = true) -> "yearly"
                            else -> "yearly"
                        }
                    )
                    viewModel.purchase(activity)
                }
            }
        },
        onRestore = { viewModel.restorePurchases() },
        onDismiss = { onNavigateBack() }
    )
}
