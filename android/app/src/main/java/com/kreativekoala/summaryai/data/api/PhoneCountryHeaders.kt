package com.kreativekoala.summaryai.data.api

import com.kreativekoala.summaryai.util.PhoneDevice
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Tells the server which countries this device is in, on phone requests only. The server decides from them whether phone
 * calls are shown (and counts only those who are shown them); without them it answers "not available".
 */
class PhoneCountryHeaders(private val device: PhoneDevice) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (!request.url.encodedPath.startsWith("/api/phone")) return chain.proceed(request)
        val countries = device.countries
        val builder = request.newBuilder()
        countries.sim?.let { builder.header(SIM, it) }
        countries.network?.let { builder.header(NETWORK, it) }
        countries.region?.let { builder.header(REGION, it) }
        if (device.isTest) builder.header(TEST, "1")
        return chain.proceed(builder.build())
    }

    companion object {
        const val SIM = "x-mm-sim-country"
        const val NETWORK = "x-mm-network-country"
        const val REGION = "x-mm-device-region"
        const val TEST = "x-mm-test"
    }
}
