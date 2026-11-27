package com.kreativekoala.summaryai.util

import android.content.Context
import android.provider.Settings
import com.kreativekoala.summaryai.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.Locale
import javax.inject.Inject

/** The few facts about this device the phone screen sends or needs. */
interface PhoneDevice {
    /** Two-letter region of the device's language settings, only used to split usage counts. */
    val region: String?
    /** The language the app is shown in. */
    val language: String
    /** Our own debug builds and Firebase Test Lab devices, which are not counted as people. */
    val isTest: Boolean
}

class AndroidPhoneDevice @Inject constructor(@ApplicationContext private val context: Context) : PhoneDevice {
    override val region: String? get() = Locale.getDefault().country.takeIf { it.length == 2 }
    override val language: String get() = appLocaleContext(context).resources.configuration.locales[0].toLanguageTag()
    override val isTest: Boolean
        get() = BuildConfig.DEBUG ||
            runCatching { Settings.System.getString(context.contentResolver, "firebase.test.lab") == "true" }.getOrDefault(false)
}
