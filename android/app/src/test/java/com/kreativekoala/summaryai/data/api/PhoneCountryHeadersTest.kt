package com.kreativekoala.summaryai.data.api

import com.kreativekoala.summaryai.util.CountrySignals
import com.kreativekoala.summaryai.util.PhoneDevice
import java.io.File
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the app tells the server about the device's countries, and where. */
class PhoneCountryHeadersTest {
    private class Device(
        override var countries: CountrySignals = CountrySignals(),
        override val isTest: Boolean = false
    ) : PhoneDevice {
        override val region: String? = null
        override val language = "en-US"
    }

    private fun sent(device: PhoneDevice, path: String): Request {
        var seen: Request? = null
        val client = OkHttpClient.Builder()
            .addInterceptor(PhoneCountryHeaders(device))
            .addInterceptor(Interceptor { chain ->
                seen = chain.request()
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
                    .body("".toResponseBody()).build()
            })
            .build()
        client.newCall(Request.Builder().url("https://example.test$path").build()).execute().close()
        return seen!!
    }

    @Test fun theSimAndNetworkCountriesAreSentAndTheRegionIsNot() {
        val request = sent(Device(CountrySignals.of("us", "ca", "DE")), "/api/phone/status")
        assertEquals("US", request.header("x-mm-sim-country"))
        assertEquals("CA", request.header("x-mm-network-country"))
        assertNull(request.header("x-mm-device-region"))
        assertNull(request.header("x-mm-test"))
    }

    @Test fun oneOfThemIsEnoughToLeaveTheRegionOut() {
        assertEquals(CountrySignals(sim = "IN"), CountrySignals.of("in", "", "US"))
        assertEquals(CountrySignals(network = "GB"), CountrySignals.of(null, "gb", "US"))
    }

    @Test fun theRegionIsTheFallbackWithoutBoth() {
        val request = sent(Device(CountrySignals.of("", null, "us"), isTest = true), "/api/phone/calls")
        assertEquals("US", request.header("x-mm-device-region"))
        assertNull(request.header("x-mm-sim-country"))
        assertEquals("1", request.header("x-mm-test"))
    }

    @Test fun anythingButATwoLetterCodeIsLeftOut() {
        assertEquals(CountrySignals(), CountrySignals.of("usa", "1", "419"))
        val request = sent(Device(CountrySignals.of(null, null, null)), "/api/phone/status")
        assertTrue(request.headers.names().none { it.startsWith("x-mm-") })
    }

    @Test fun theCountriesAreReadForEveryRequest() {
        val device = Device(CountrySignals(network = "US"))
        assertEquals("US", sent(device, "/api/phone/status").header("x-mm-network-country"))
        device.countries = CountrySignals(network = "MX")
        assertEquals("MX", sent(device, "/api/phone/status").header("x-mm-network-country"))
    }

    @Test fun nothingIsSentOutsideThePhoneRoutes() {
        val request = sent(Device(CountrySignals(sim = "US"), isTest = true), "/api/recordings")
        assertTrue(request.headers.names().none { it.startsWith("x-mm-") })
    }

    /** The names are a contract with the server. */
    @Test fun theServerReadsTheSameHeaderNames() {
        val server = File("../../backend/src/phone/availability.ts")
        assertTrue("expected ${server.absolutePath}", server.exists())
        val source = server.readText()
        for (name in listOf(PhoneCountryHeaders.SIM, PhoneCountryHeaders.NETWORK, PhoneCountryHeaders.REGION, PhoneCountryHeaders.TEST)) {
            assertTrue("server does not read $name", source.contains("'$name'"))
        }
    }
}
