package com.kreativekoala.summaryai.ui.paywall

import android.app.Activity
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Offering
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesError
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback
import com.revenuecat.purchases.purchaseWith
import dagger.hilt.android.lifecycle.HiltViewModel
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
    val offering: Offering? = null,
    val hasActiveEntitlement: Boolean = false
)

@HiltViewModel
class PaywallViewModel @Inject constructor() : ViewModel() {

    private val _uiState = MutableStateFlow(PaywallUiState())
    val uiState: StateFlow<PaywallUiState> = _uiState.asStateFlow()

    companion object {
        private const val TAG = "PaywallViewModel"
        private const val ENTITLEMENT_ID = "premium"
    }

    init {
        loadOfferings()
        checkEntitlements()
    }

    private fun loadOfferings() {
        _uiState.value = _uiState.value.copy(isLoading = true)

        Purchases.sharedInstance.getOfferingsWith(
            onError = { error ->
                Log.e(TAG, "Failed to load offerings: ${error.message}")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = error.message
                )
            },
            onSuccess = { offerings ->
                Log.d(TAG, "Loaded offerings: ${offerings.current?.availablePackages?.size ?: 0} packages")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    offering = offerings.current
                )
            }
        )
    }

    private fun checkEntitlements() {
        Purchases.sharedInstance.getCustomerInfo(object : ReceiveCustomerInfoCallback {
            override fun onReceived(customerInfo: CustomerInfo) {
                val hasEntitlement = customerInfo.entitlements[ENTITLEMENT_ID]?.isActive == true
                _uiState.value = _uiState.value.copy(
                    hasActiveEntitlement = hasEntitlement,
                    purchaseSuccess = hasEntitlement
                )
                Log.d(TAG, "Customer has premium entitlement: $hasEntitlement")
            }

            override fun onError(error: PurchasesError) {
                Log.e(TAG, "Failed to get customer info: ${error.message}")
            }
        })
    }

    fun selectPlan(plan: String) {
        _uiState.value = _uiState.value.copy(selectedPlan = plan)
    }

    fun purchase(activity: Activity) {
        val offering = _uiState.value.offering ?: run {
            _uiState.value = _uiState.value.copy(error = "No offerings available")
            return
        }

        val packageToPurchase = getSelectedPackage(offering) ?: run {
            _uiState.value = _uiState.value.copy(error = "Selected plan not found")
            return
        }

        launchPurchaseFlow(activity, packageToPurchase)
    }

    private fun getSelectedPackage(offering: Offering): Package? {
        return when (_uiState.value.selectedPlan) {
            "yearly" -> offering.annual
            "monthly" -> offering.monthly
            "weekly" -> offering.weekly
            else -> offering.annual
        }
    }

    private fun launchPurchaseFlow(activity: Activity, packageToPurchase: Package) {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)

        Purchases.sharedInstance.purchaseWith(
            PurchaseParams.Builder(activity, packageToPurchase).build(),
            onError = { error, userCancelled ->
                Log.e(TAG, "Purchase failed: ${error.message}, userCancelled: $userCancelled")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = if (!userCancelled) error.message else null
                )
            },
            onSuccess = { _, customerInfo ->
                val hasEntitlement = customerInfo.entitlements[ENTITLEMENT_ID]?.isActive == true
                Log.d(TAG, "Purchase successful, has entitlement: $hasEntitlement")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    purchaseSuccess = hasEntitlement,
                    hasActiveEntitlement = hasEntitlement
                )
            }
        )
    }

    fun restorePurchases() {
        _uiState.value = _uiState.value.copy(isLoading = true, error = null)

        Purchases.sharedInstance.restorePurchasesWith(
            onError = { error ->
                Log.e(TAG, "Restore failed: ${error.message}")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = error.message
                )
            },
            onSuccess = { customerInfo ->
                val hasEntitlement = customerInfo.entitlements[ENTITLEMENT_ID]?.isActive == true
                Log.d(TAG, "Restore successful, has entitlement: $hasEntitlement")
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    purchaseSuccess = hasEntitlement,
                    hasActiveEntitlement = hasEntitlement,
                    error = if (!hasEntitlement) "No active subscription found" else null
                )
            }
        )
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    /**
     * Login to RevenueCat with the user's Supabase ID
     * Call this after user authentication
     */
    fun loginUser(userId: String) {
        viewModelScope.launch {
            Purchases.sharedInstance.logInWith(
                userId,
                onError = { error ->
                    Log.e(TAG, "RevenueCat login failed: ${error.message}")
                },
                onSuccess = { customerInfo, _ ->
                    val hasEntitlement = customerInfo.entitlements[ENTITLEMENT_ID]?.isActive == true
                    _uiState.value = _uiState.value.copy(
                        hasActiveEntitlement = hasEntitlement,
                        purchaseSuccess = hasEntitlement
                    )
                    Log.d(TAG, "RevenueCat login successful for user: $userId")
                }
            )
        }
    }

    /**
     * Logout from RevenueCat (resets to anonymous user)
     * Call this when user signs out
     */
    fun logoutUser() {
        viewModelScope.launch {
            Purchases.sharedInstance.logOutWith(
                onError = { error ->
                    Log.e(TAG, "RevenueCat logout failed: ${error.message}")
                },
                onSuccess = { customerInfo ->
                    _uiState.value = _uiState.value.copy(
                        hasActiveEntitlement = false,
                        purchaseSuccess = false
                    )
                    Log.d(TAG, "RevenueCat logout successful")
                }
            )
        }
    }
}
