package com.kreativekoala.summaryai.ui.paywall

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.revenuecat.purchases.ui.revenuecatui.Paywall
import com.revenuecat.purchases.ui.revenuecatui.PaywallOptions

/**
 * Paywall screen - uses RevenueCat's dashboard-configured paywall.
 */
@Composable
fun PaywallScreen(
    onNavigateBack: () -> Unit,
    onPurchaseSuccess: () -> Unit
) {
    Box(modifier = Modifier.fillMaxSize()) {
        Paywall(
            options = PaywallOptions.Builder(dismissRequest = { onNavigateBack() })
                .setShouldDisplayDismissButton(true)
                .build()
        )
    }
}
