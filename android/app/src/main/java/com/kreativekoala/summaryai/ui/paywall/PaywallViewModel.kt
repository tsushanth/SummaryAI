package com.kreativekoala.summaryai.ui.paywall

import android.app.Activity
import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.android.billingclient.api.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PaywallUiState(
    val selectedPlan: String = "yearly",
    val isLoading: Boolean = false,
    val purchaseSuccess: Boolean = false,
    val error: String? = null,
    val products: List<ProductDetails> = emptyList()
)

@HiltViewModel
class PaywallViewModel @Inject constructor(
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _uiState = MutableStateFlow(PaywallUiState())
    val uiState: StateFlow<PaywallUiState> = _uiState.asStateFlow()

    private var billingClient: BillingClient? = null

    companion object {
        const val PRODUCT_MONTHLY = "pro_monthly"
        const val PRODUCT_YEARLY = "pro_yearly"
    }

    init {
        setupBillingClient()
    }

    private fun setupBillingClient() {
        billingClient = BillingClient.newBuilder(context)
            .setListener { billingResult, purchases ->
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
                    for (purchase in purchases) {
                        handlePurchase(purchase)
                    }
                }
            }
            .enablePendingPurchases()
            .build()

        billingClient?.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    queryProducts()
                }
            }

            override fun onBillingServiceDisconnected() {
                // Try to reconnect
            }
        })
    }

    private fun queryProducts() {
        val productList = listOf(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRODUCT_MONTHLY)
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRODUCT_YEARLY)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        )

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(productList)
            .build()

        billingClient?.queryProductDetailsAsync(params) { billingResult, productDetailsList ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                _uiState.value = _uiState.value.copy(products = productDetailsList)
            }
        }
    }

    fun selectPlan(plan: String) {
        _uiState.value = _uiState.value.copy(selectedPlan = plan)
    }

    fun purchase() {
        val productId = if (_uiState.value.selectedPlan == "yearly") PRODUCT_YEARLY else PRODUCT_MONTHLY
        val product = _uiState.value.products.find { it.productId == productId }

        if (product == null) {
            _uiState.value = _uiState.value.copy(error = "Product not found")
            return
        }

        _uiState.value = _uiState.value.copy(isLoading = true)

        // In a real app, you would get the activity from the composable context
        // and call launchBillingFlow
        viewModelScope.launch {
            // Simulating purchase for now
            kotlinx.coroutines.delay(1000)
            _uiState.value = _uiState.value.copy(
                isLoading = false,
                error = "Google Play Billing requires an Activity context. Please configure in production."
            )
        }
    }

    fun launchPurchaseFlow(activity: Activity) {
        val productId = if (_uiState.value.selectedPlan == "yearly") PRODUCT_YEARLY else PRODUCT_MONTHLY
        val product = _uiState.value.products.find { it.productId == productId }

        if (product == null) {
            _uiState.value = _uiState.value.copy(error = "Product not found")
            return
        }

        val offerToken = product.subscriptionOfferDetails?.firstOrNull()?.offerToken
        if (offerToken == null) {
            _uiState.value = _uiState.value.copy(error = "No offer available")
            return
        }

        val productDetailsParamsList = listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(product)
                .setOfferToken(offerToken)
                .build()
        )

        val billingFlowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(productDetailsParamsList)
            .build()

        billingClient?.launchBillingFlow(activity, billingFlowParams)
    }

    private fun handlePurchase(purchase: Purchase) {
        if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
            // Acknowledge the purchase
            if (!purchase.isAcknowledged) {
                val acknowledgePurchaseParams = AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.purchaseToken)
                    .build()

                billingClient?.acknowledgePurchase(acknowledgePurchaseParams) { billingResult ->
                    if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            purchaseSuccess = true
                        )
                    }
                }
            } else {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    purchaseSuccess = true
                )
            }
        }
    }

    fun restorePurchases() {
        _uiState.value = _uiState.value.copy(isLoading = true)

        billingClient?.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        ) { billingResult, purchases ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                val hasActivePurchase = purchases.any {
                    it.purchaseState == Purchase.PurchaseState.PURCHASED
                }

                if (hasActivePurchase) {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        purchaseSuccess = true
                    )
                } else {
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = "No active subscription found"
                    )
                }
            } else {
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = "Failed to restore purchases"
                )
            }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    override fun onCleared() {
        super.onCleared()
        billingClient?.endConnection()
    }
}
