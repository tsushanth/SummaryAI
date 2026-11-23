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
