package com.kreativekoala.summaryai.service

import android.app.Activity
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import android.content.Context
import android.util.Log
import com.android.billingclient.api.*
import com.kreativekoala.summaryai.data.local.SubscriptionStatus
import com.kreativekoala.summaryai.service.FacebookSDKHelper
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

data class BillingProduct(
    val productId: String,
    val title: String,
    val localizedPrice: String,
    val price: Double,
    val currencyCode: String,
    val period: Period,
    val trialDays: Int? = null,
    val productDetails: ProductDetails,
    val offerToken: String
) {
    enum class Period { WEEKLY, MONTHLY, YEARLY }
}

@Singleton
class BillingManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val subscriptionStatus: SubscriptionStatus
) : PurchasesUpdatedListener {

    companion object {
        private const val TAG = "BillingManager"
        const val COACHING_SUB_PRODUCT_ID = "mm_coach_unlimited_monthly"
        // MM Pro subscription IDs only. Coaching is queried separately so a
        // misconfigured coaching IAP can never break the main paywall.
        private val PRODUCT_IDS = listOf(
            "meetingmindproweekly",
            "monthly",
            "yearly",
            "com.summaryai.subscription.weekly",
            "com.summaryai.subscription.monthly",
            "com.summaryai.subscription.yearly1",
        )
    }

    /** Coaching subscription product. Populated in a separate, fault-tolerant query. */
    private val _coachingProduct = MutableStateFlow<BillingProduct?>(null)
    val coachingProduct: StateFlow<BillingProduct?> = _coachingProduct

    /** Callback for coaching subscription purchases — owner posts the token to backend for verification + credit grant. */
    var onCoachingSubscriptionPurchased: ((productId: String, purchaseToken: String) -> Unit)? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _isSubscribed = MutableStateFlow(false)
    val isSubscribed: StateFlow<Boolean> = _isSubscribed

    private val _products = MutableStateFlow<List<BillingProduct>>(emptyList())
    val products: StateFlow<List<BillingProduct>> = _products

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    private val billingClient = BillingClient.newBuilder(context)
        .setListener(this)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
        )
        .build()

    fun initialize() {
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.d(TAG, "Billing client connected")
                    scope.launch {
                        queryProducts()
                        // Coaching query is isolated: its failure (e.g. product still propagating
                        // in Play Console) must NOT block the main paywall from rendering.
                        runCatching { queryCoachingProduct() }
                            .onFailure { Log.w(TAG, "queryCoachingProduct failed (non-fatal): ${it.message}") }
                        queryExistingPurchases()
                    }
                } else {
                    Log.w(TAG, "Billing setup failed: ${result.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing service disconnected — will retry on next call")
            }
        })
    }

    private suspend fun queryProducts() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                PRODUCT_IDS.map { id ->
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(id)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                }
            )
            .build()

        val result = billingClient.queryProductDetails(params)
        if (result.billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
            val billingProducts = result.productDetailsList?.mapNotNull { details ->
                val subOffer = details.subscriptionOfferDetails?.firstOrNull() ?: return@mapNotNull null
                val offerToken = subOffer.offerToken

                // Detect free trial from pricing phases
                val trialDays = subOffer.pricingPhases.pricingPhaseList
                    .firstOrNull { it.priceAmountMicros == 0L }
                    ?.let { phase ->
                        val billingPeriod = phase.billingPeriod // e.g. P7D, P1M
                        when {
                            billingPeriod.contains("D") -> billingPeriod.filter { it.isDigit() }.toIntOrNull()
                            billingPeriod.contains("W") -> (billingPeriod.filter { it.isDigit() }.toIntOrNull() ?: 1) * 7
                            else -> null
                        }
                    }

                // Get the paid phase price
                val paidPhase = subOffer.pricingPhases.pricingPhaseList
                    .firstOrNull { it.priceAmountMicros > 0 } ?: return@mapNotNull null

                // Derive period from billing cycle of the paid phase
                val period = when {
                    paidPhase.billingPeriod == "P1W" || paidPhase.billingPeriod == "P7D"
                        || details.productId.contains("week", ignoreCase = true) -> BillingProduct.Period.WEEKLY
                    paidPhase.billingPeriod == "P1M"
                        || details.productId == "monthly"
                        || details.productId.contains("month", ignoreCase = true) -> BillingProduct.Period.MONTHLY
                    else -> BillingProduct.Period.YEARLY
                }

                BillingProduct(
                    productId = details.productId,
                    title = details.title,
                    localizedPrice = paidPhase.formattedPrice,
                    price = paidPhase.priceAmountMicros / 1_000_000.0,
                    currencyCode = paidPhase.priceCurrencyCode,
                    period = period,
                    trialDays = trialDays,
                    productDetails = details,
                    offerToken = offerToken
                )
            }?.sortedBy { it.period.ordinal } ?: emptyList()

            _products.value = billingProducts
            Log.d(TAG, "Loaded ${billingProducts.size} products")
        } else {
            Log.w(TAG, "queryProductDetails failed: ${result.billingResult.debugMessage}")
        }
    }

    /** Isolated coaching subscription query. Errors here must not affect _products. */
    private suspend fun queryCoachingProduct() {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(COACHING_SUB_PRODUCT_ID)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                )
            )
            .build()
        val result = billingClient.queryProductDetails(params)
        if (result.billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
            Log.w(TAG, "queryCoachingProduct: ${result.billingResult.debugMessage} (code=${result.billingResult.responseCode})")
            return
        }
        val details = result.productDetailsList?.firstOrNull() ?: run {
            Log.w(TAG, "queryCoachingProduct: product not available yet (Play Console may still be propagating)")
            return
        }
        val subOffer = details.subscriptionOfferDetails?.firstOrNull() ?: return
        val paidPhase = subOffer.pricingPhases.pricingPhaseList.firstOrNull { it.priceAmountMicros > 0 } ?: return
        _coachingProduct.value = BillingProduct(
            productId = details.productId,
            title = details.title,
            localizedPrice = paidPhase.formattedPrice,
            price = paidPhase.priceAmountMicros / 1_000_000.0,
            currencyCode = paidPhase.priceCurrencyCode,
            period = BillingProduct.Period.MONTHLY,
            trialDays = null,
            productDetails = details,
            offerToken = subOffer.offerToken,
        )
        Log.d(TAG, "Loaded coaching product: ${details.productId} @ ${paidPhase.formattedPrice}")
    }

    suspend fun queryExistingPurchases() {
        val result = billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        )
        // Coaching subscription is separate from MM Pro — don't let it flip the Pro gate.
        val hasActive = result.purchasesList.any { purchase ->
            purchase.purchaseState == Purchase.PurchaseState.PURCHASED &&
                purchase.products.none { it == COACHING_SUB_PRODUCT_ID }
        }
        _isSubscribed.value = hasActive
        subscriptionStatus.setActive(hasActive)
        Log.d(TAG, "Existing purchases check — subscribed: $hasActive")

        // Acknowledge any unacknowledged purchases
        result.purchasesList.forEach { purchase ->
            if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED && !purchase.isAcknowledged) {
                acknowledgePurchase(purchase)
            }
        }
    }

    /** Find the coaching subscription product if Play returned it during queryCoachingProduct. */
    fun findCoachingSubscription(): BillingProduct? = _coachingProduct.value

    /**
     * Launch Play's billing flow for the coaching subscription. Returns true if
     * the flow could be launched; false if the product isn't loaded (IAP not
     * created in Play Console yet, or queryProducts hasn't completed).
     */
    fun purchaseCoachingSubscription(activity: Activity): Boolean {
        val product = findCoachingSubscription() ?: run {
            Log.w(TAG, "Coaching subscription product not loaded; cannot launch flow.")
            return false
        }
        launchBillingFlow(activity, product)
        return true
    }

    fun launchBillingFlow(activity: Activity, product: BillingProduct) {
        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(product.productDetails)
                        .setOfferToken(product.offerToken)
                        .build()
                )
            )
            .build()

        _isLoading.value = true
        val result = billingClient.launchBillingFlow(activity, flowParams)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            _isLoading.value = false
            Log.w(TAG, "launchBillingFlow failed: ${result.debugMessage}")
        }
    }

    /**
     * Opens the Google Play promo code redemption flow.
     */
    fun redeemPromoCode(activity: Activity) {
        val params = InAppMessageParams.newBuilder()
            .addInAppMessageCategoryToShow(InAppMessageParams.InAppMessageCategoryId.TRANSACTIONAL)
            .build()
        // showInAppMessages handles subscription management; for promo code redemption
        // we open the Play Store redeem flow directly.
        billingClient.showInAppMessages(activity, params) { result ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(TAG, "In-app message shown")
            }
        }
        // Also trigger the Play Store promo code redemption UI
        try {
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                data = android.net.Uri.parse("https://play.google.com/redeem")
                setPackage("com.android.vending")
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "Could not open Play Store redeem flow: ${e.message}")
        }
    }

    /**
     * Shows Google Play in-app messaging (subscription management, price change confirmations).
     * Call on Activity resume to re-engage lapsed subscribers.
     */
    fun showInAppMessages(activity: Activity) {
        val params = InAppMessageParams.newBuilder()
            .addInAppMessageCategoryToShow(InAppMessageParams.InAppMessageCategoryId.TRANSACTIONAL)
            .build()
        billingClient.showInAppMessages(activity, params) { result ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK
                && result.purchaseToken != null) {
                // A purchase was recovered — re-check subscription status
                Log.d(TAG, "In-app message recovered purchase, re-querying")
                scope.launch { queryExistingPurchases() }
            }
        }
    }

    fun restorePurchases() {
        _isLoading.value = true
        scope.launch {
            queryExistingPurchases()
            _isLoading.value = false
        }
    }

    private fun acknowledgePurchase(purchase: Purchase) {
        scope.launch {
            val params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.purchaseToken)
                .build()
            val result = billingClient.acknowledgePurchase(params)
            Log.d(TAG, "Acknowledge result: ${result.responseCode}")
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
        _isLoading.value = false
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                purchases?.forEach { purchase ->
                    if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                        val productId = purchase.products.firstOrNull() ?: ""
                        // Coaching subscription has its own credit pipeline — do NOT mark
                        // the user as MM Pro. Fire callback to the owner so the token gets
                        // shipped to the backend for verification + credit grant.
                        if (productId == COACHING_SUB_PRODUCT_ID) {
                            if (!purchase.isAcknowledged) acknowledgePurchase(purchase)
                            onCoachingSubscriptionPurchased?.invoke(productId, purchase.purchaseToken)
                            Log.d(TAG, "Coaching subscription purchased: $productId")
                            return@forEach
                        }
                        _isSubscribed.value = true
                        subscriptionStatus.setActive(true)
                        PromoCodeManager.clearAfterConversion()
                        if (!purchase.isAcknowledged) acknowledgePurchase(purchase)
                        // Pull real price + currency from our loaded BillingProduct so
                        // Meta sees actual revenue values (was hardcoded 0/USD before).
                        val billingProduct = _products.value.firstOrNull { it.productId == productId }
                        val price = billingProduct?.price ?: 0.0
                        val currency = billingProduct?.currencyCode ?: "USD"
                        FacebookSDKHelper.logPurchase(price, currency, productId)
                        // Trial-start is a separate Meta event used for LTV cohorting.
                        // Dedupe inside the helper avoids re-firing on renewals.
                        if ((billingProduct?.trialDays ?: 0) > 0) {
                            FacebookSDKHelper.logTrialStartedOnce(productId)
                        }
                        // PaywallKit conversion telemetry — fires Supabase paywall_events row
                        // so we can reconcile against ASC/Play sales like VibeBuild Android does.
                        com.kreativekoala.paywallkit.manager.PaywallManager.trackEvent(
                            appId = "meetingmind",
                            placement = "play_billing_confirmed",
                            templateId = "default",
                            event = "purchased",
                            productId = productId,
                        )
                        Log.d(TAG, "Purchase successful: ${purchase.products} ($currency $price)")
                    }
                }
            }
            BillingClient.BillingResponseCode.USER_CANCELED ->
                Log.d(TAG, "Purchase cancelled by user")
            else ->
                Log.w(TAG, "Purchase failed: ${result.debugMessage}")
        }
    }
}
