package com.kreativekoala.summaryai

import android.app.Application
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import com.kreativekoala.summaryai.service.FirebaseAnalyticsHelper
import com.kreativekoala.summaryai.service.TikTokHelper
import com.kreativekoala.paywallkit.manager.ExperimentManager
import dagger.hilt.android.HiltAndroidApp

/**
 * Main Application class for Meeting Mind
 * Annotated with @HiltAndroidApp to trigger Hilt's code generation
 */
@HiltAndroidApp
class MeetingMindApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // Initialize PaywallKit experiment manager
        ExperimentManager.init(this)

        // Initialize RevenueCat for in-app purchases
        configureRevenueCat()

        // Initialize Firebase Analytics for Google Ads conversion tracking
        FirebaseAnalyticsHelper.initialize(this)

        // Initialize TikTok Events SDK for install attribution
        TikTokHelper.initialize(this)
    }

    private fun configureRevenueCat() {
        // Enable debug logs in debug builds
        Purchases.logLevel = if (BuildConfig.DEBUG) LogLevel.DEBUG else LogLevel.WARN

        val apiKey = "goog_WycDXwagKtRThrBBPbEYZWFDTmd"

        Purchases.configure(
            PurchasesConfiguration.Builder(this, apiKey)
                .build()
        )

        android.util.Log.d("MeetingMindApp", "RevenueCat configured")
    }
}
