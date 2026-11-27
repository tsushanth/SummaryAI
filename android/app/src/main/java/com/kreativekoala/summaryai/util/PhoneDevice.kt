package com.kreativekoala.summaryai.util

import android.content.Context
import android.telephony.TelephonyManager
import androidx.core.app.LocaleManagerCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject

/** The few facts about this device the phone feature sends or needs. */
interface PhoneDevice {
    /** Two-letter region of the device's own language settings (not the app's language). */
    val region: String?
    /** SIM and network country, or [region] when there is neither. Read each time: a SIM or network can change. */
    val countries: CountrySignals
    /** The language the app is shown in. */
    val language: String
    /** Installs that are not counted as people (see [TestInstall]). */
    val isTest: Boolean
}

class AndroidPhoneDevice @Inject constructor(@ApplicationContext private val context: Context) : PhoneDevice {
    override val region: String?
        get() = CountrySignals.code(runCatching { LocaleManagerCompat.getSystemLocales(context)[0]?.country }.getOrNull())

    override val countries: CountrySignals
        get() {
            val telephony = runCatching { context.getSystemService(TelephonyManager::class.java) }.getOrNull()
            return CountrySignals.of(
                sim = runCatching { telephony?.simCountryIso }.getOrNull(),
                network = runCatching { telephony?.networkCountryIso }.getOrNull(),
                region = region
            )
        }

    override val language: String get() = appLocaleContext(context).resources.configuration.locales[0].toLanguageTag()
    override val isTest: Boolean by lazy { TestInstall.isTest(context) }
}
