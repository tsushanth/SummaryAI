package com.kreativekoala.summaryai.ui.paywall

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.paywallkit.manager.ExperimentManager
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import com.kreativekoala.paywallkit.models.PaywallFeature
import com.kreativekoala.paywallkit.models.PaywallProduct
import com.kreativekoala.paywallkit.models.PaywallTheme
import com.kreativekoala.paywallkit.view.PaywallView
import com.kreativekoala.summaryai.service.BillingProduct

@Composable
fun PaywallScreen(
    onNavigateBack: () -> Unit,
    onPurchaseSuccess: () -> Unit,
    forceHardGate: Boolean = false,
    viewModel: PaywallViewModel = hiltViewModel()
) {
    val products by viewModel.products.collectAsState()
    val isSubscribed by viewModel.isSubscribed.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val activity = LocalContext.current as? Activity

    // Hard gate overrides the server-side ExperimentManager. Used when the
    // user attempts a gated action (start recording, join meeting, place call)
    // after exhausting their free opens — they must convert or background.
    val dismissible = if (forceHardGate) false else ExperimentManager.isDismissible()

    BackHandler(enabled = !dismissible) { /* swallow back */ }

    LaunchedEffect(isSubscribed) {
        if (isSubscribed) onPurchaseSuccess()
    }

    if (products.isEmpty() || isLoading) {
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

    val paywallProducts = products.map { product ->
        PaywallProduct(
            id = product.productId,
            localizedPrice = product.localizedPrice,
            price = product.price,
            currencyCode = product.currencyCode,
            trialDays = product.trialDays,
            period = when (product.period) {
                BillingProduct.Period.WEEKLY -> PaywallProduct.Period.WEEKLY
                BillingProduct.Period.MONTHLY -> PaywallProduct.Period.MONTHLY
                BillingProduct.Period.YEARLY -> PaywallProduct.Period.YEARLY
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
        placement = if (PromoCodeManager.activeCode != null) "promo_code_onboarding" else "onboarding",
        appName = "MeetingMind",
        features = features,
        products = paywallProducts,
        theme = PaywallTheme(
            accent = Color(0xFF6C63FF),
            accent2 = Color(0xFF9C27B0)
        ),
        showWinback = true,
        isDismissible = dismissible,
        onPurchase = { productId ->
            val product = products.firstOrNull { it.productId == productId }
            if (product != null && activity != null) {
                viewModel.purchase(activity, product)
            }
        },
        onRestore = { viewModel.restorePurchases() },
        onRedeemCode = {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/redeem?code=mm2024promo"))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { activity?.startActivity(intent) } catch (_: Exception) {}
        },
        onDismiss = { onNavigateBack() }
    )
}
