package com.kreativekoala.summaryai

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Main Application class for Meeting Mind
 * Annotated with @HiltAndroidApp to trigger Hilt's code generation
 */
@HiltAndroidApp
class MeetingMindApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        // Initialize any app-wide components here
    }
}
