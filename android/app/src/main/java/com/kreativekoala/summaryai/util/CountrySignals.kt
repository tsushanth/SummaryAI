package com.kreativekoala.summaryai.util

import java.util.Locale

/**
 * The countries the server uses to decide whether phone calls are shown: the SIM's and the mobile network's, and the
 * device region only when there is neither. Two-letter codes; reading them needs no permission.
 */
data class CountrySignals(val sim: String? = null, val network: String? = null, val region: String? = null) {
    companion object {
        fun of(sim: String?, network: String?, region: String?): CountrySignals {
            val simCode = code(sim)
            val networkCode = code(network)
            return CountrySignals(simCode, networkCode, if (simCode == null && networkCode == null) code(region) else null)
        }

        /** Upper-case two-letter code, or null (empty, or a numbered region such as 419). */
        fun code(value: String?): String? = value?.trim()
            ?.takeIf { it.length == 2 && it.all { c -> c in 'a'..'z' || c in 'A'..'Z' } }
            ?.uppercase(Locale.ROOT)
    }
}
