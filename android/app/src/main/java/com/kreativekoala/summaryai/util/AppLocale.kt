package com.kreativekoala.summaryai.util

import android.content.Context
import android.content.res.Configuration
import androidx.appcompat.app.AppCompatDelegate

/**
 * [context] with the language the person picked in the app's language picker. Before Android 13 AppCompat applies that
 * choice to activities only, so the application context a ViewModel holds would still resolve strings in the system
 * language. On Android 13+ and when no per-app language is set this returns [context] as is. Never throws.
 */
fun appLocaleContext(context: Context): Context = try {
    val locales = AppCompatDelegate.getApplicationLocales()
    val first = if (locales.isEmpty) null else locales.get(0)
    if (first == null || context.resources.configuration.locales.get(0)?.toLanguageTag() == first.toLanguageTag()) {
        context
    } else {
        val config = Configuration(context.resources.configuration)
        config.setLocale(first)
        context.createConfigurationContext(config)
    }
} catch (_: Throwable) {
    context
}

private const val APPCOMPAT_LOCALES_MARKER = "androidx.appcompat.app.AppLocalesMetadataHolderService"

/**
 * True when AppCompat's one-time "sync stored locales to the framework" step must be skipped. On Android 13+ the first
 * time an activity starts, AppCompat 1.7 overwrites the framework's per-app locale with its own stored copy, which is
 * empty on a fresh install. That wipes a language chosen in system Settings (or via `cmd locale set-app-locales`)
 * before the first launch, so the first screen is shown in the system language. The sync only exists to migrate a
 * language AppCompat stored on Android 12 and older, so it is safe to skip when the framework already has one.
 */
internal fun shouldSkipAppCompatLocaleSync(markerAlreadyEnabled: Boolean, frameworkHasLocales: Boolean): Boolean =
    !markerAlreadyEnabled && frameworkHasLocales

/**
 * Call from Application.onCreate (before any activity). Marks AppCompat's locale sync as done when the system already
 * holds a per-app language, so the language chosen before the first launch survives. Never throws.
 */
fun preserveFrameworkAppLocales(context: Context) {
    if (android.os.Build.VERSION.SDK_INT < 33) return
    try {
        val marker = android.content.ComponentName(context, APPCOMPAT_LOCALES_MARKER)
        val pm = context.packageManager
        val enabled = pm.getComponentEnabledSetting(marker) == android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED
        val framework = context.getSystemService(android.app.LocaleManager::class.java)?.applicationLocales
        if (shouldSkipAppCompatLocaleSync(enabled, framework != null && !framework.isEmpty)) {
            pm.setComponentEnabledSetting(
                marker,
                android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                android.content.pm.PackageManager.DONT_KILL_APP,
            )
        }
    } catch (_: Throwable) {
        // Worst case AppCompat runs its own sync, which is the previous behaviour.
    }
}
