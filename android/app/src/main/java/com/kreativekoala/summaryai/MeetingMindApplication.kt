package com.kreativekoala.summaryai

import android.app.Application
import com.kreativekoala.summaryai.service.FacebookSDKHelper
import com.kreativekoala.summaryai.service.FirebaseAnalyticsHelper
import com.kreativekoala.summaryai.service.TikTokHelper
import com.kreativekoala.paywallkit.manager.ExperimentManager
import com.kreativekoala.paywallkit.manager.PaywallManager
import com.kreativekoala.paywallkit.manager.PromoCodeManager
import com.kreativekoala.ratingkit.RatingKit
import dagger.hilt.android.HiltAndroidApp

/**
 * Main Application class for Meeting Mind
 */
@HiltAndroidApp
class MeetingMindApplication : Application() {

    override fun onCreate() {
        super.onCreate()

        // Initialize PaywallKit experiment manager
        ExperimentManager.init(this)
        PromoCodeManager.init(this)
        // Restore captured user email so subsequent paywall events auto-attach it.
        PaywallManager.restoreUserEmail(this)

        // Initialize Firebase Analytics for Google Ads conversion tracking
        FirebaseAnalyticsHelper.initialize(this)

        // Initialize TikTok Events SDK for install attribution
        TikTokHelper.initialize(this)

        // Initialize Facebook SDK for Meta Ads attribution
        FacebookSDKHelper.initialize(this)

        // Initialize RatingKit (Play In-App Review)
        RatingKit.init(this, appId = "meetingmind")
    }
}
