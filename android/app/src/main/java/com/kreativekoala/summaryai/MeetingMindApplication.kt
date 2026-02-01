package com.kreativekoala.summaryai

import android.app.Application
import com.revenuecat.purchases.LogLevel
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import dagger.hilt.android.HiltAndroidApp

/**
 * Main Application class for Meeting Mind
 * Annotated with @HiltAndroidApp to trigger Hilt's code generation
 */
@HiltAndroidApp
class MeetingMindApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // Initialize RevenueCat for in-app purchases
        configureRevenueCat()
    }

    private fun configureRevenueCat() {
        // Enable debug logs in debug builds
        Purchases.logLevel = if (BuildConfig.DEBUG) LogLevel.DEBUG else LogLevel.WARN

        // TODO: Replace with your RevenueCat Android API key
        val apiKey = "YOUR_REVENUECAT_ANDROID_API_KEY"

        Purchases.configure(
            PurchasesConfiguration.Builder(this, apiKey)
                .build()
        )

        android.util.Log.d("MeetingMindApp", "RevenueCat configured")
    }
}
