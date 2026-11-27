package com.kreativekoala.summaryai.service

import android.app.Activity
import com.kreativekoala.summaryai.data.local.TokenManager
import kotlinx.coroutines.flow.SharedFlow
import java.security.MessageDigest
import javax.inject.Inject

/** Buying the subscription for an own number. Offered only when the server says it can be bought. */
interface PhonePurchases {
    /** (product, purchase token) of purchases completed in Google Play's screen. */
    val completed: SharedFlow<Pair<String, String>>
    /** The price Google Play shows for the product, or null when it cannot be bought here. */
    suspend fun price(productId: String): String?
    /** Opens Google Play's purchase screen. False when it could not be opened. */
    suspend fun buy(activity: Activity, productId: String): Boolean
    /** The token of a purchase this device already holds, to confirm one the server has not seen. */
    suspend fun ownedToken(productId: String): String?
}

/** What ties a Play purchase to an account without naming it: the server compares the same hash. */
fun accountHash(userId: String): String =
    MessageDigest.getInstance("SHA-256").digest(userId.toByteArray()).joinToString("") { "%02x".format(it) }

class PlayPhonePurchases @Inject constructor(
    private val billing: BillingManager,
    private val tokens: TokenManager
) : PhonePurchases {
    override val completed: SharedFlow<Pair<String, String>> get() = billing.phonePurchases

    override suspend fun price(productId: String): String? = billing.phoneProduct(productId)?.localizedPrice

    override suspend fun buy(activity: Activity, productId: String): Boolean {
        val userId = tokens.userId ?: return false
        val product = billing.phoneProduct(productId) ?: return false
        return billing.launchPhonePurchase(activity, product, accountHash(userId))
    }

    override suspend fun ownedToken(productId: String): String? = billing.phonePurchaseToken(productId)
}
