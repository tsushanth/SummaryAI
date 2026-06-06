package com.kreativekoala.summaryai.ui.paywall

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.service.BillingManager
import com.kreativekoala.summaryai.service.BillingProduct
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class PaywallViewModel @Inject constructor(
    private val billingManager: BillingManager
) : ViewModel() {

    val products = billingManager.products
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val isSubscribed = billingManager.isSubscribed
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    val isLoading = billingManager.isLoading
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), false)

    fun purchase(activity: Activity, product: BillingProduct) {
        billingManager.launchBillingFlow(activity, product)
    }

    fun restorePurchases() {
        billingManager.restorePurchases()
    }

    fun redeemPromoCode(activity: Activity) {
        billingManager.redeemPromoCode(activity)
    }

    fun refreshSubscriptionStatus() {
        viewModelScope.launch { billingManager.queryExistingPurchases() }
    }
}
