package com.kreativekoala.summaryai.ui.phone

import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.PhoneCallStatus
import com.kreativekoala.summaryai.domain.model.formatPhoneNumber
import com.kreativekoala.summaryai.service.CallEndReason
import com.kreativekoala.summaryai.service.PhoneAvailabilityState
import com.kreativekoala.summaryai.service.callEndReason
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneRulesTest {
    @Test fun aNumberNeedsItsCountryCodeAndIsNeverGivenOne() {
        assertEquals(R.string.phone_error_country_code, phoneNumberProblem("415 555 0100"))
        assertEquals(R.string.phone_error_country_code, phoneNumberProblem("14155550100"))
        assertNull(phoneNumberProblem("+1 (415) 555-0100"))
        assertEquals(R.string.phone_error_country_unsupported, phoneNumberProblem("+44 7700 900123"))
        assertEquals(R.string.phone_error_invalid_number, phoneNumberProblem("+1 415 555"))
        assertEquals(R.string.phone_error_invalid_number, phoneNumberProblem("+1415555010x"))
        assertEquals(R.string.error_enter_phone_number, phoneNumberProblem("  "))
    }

    @Test fun verificationFailuresHaveTheirOwnText() {
        assertEquals(R.string.phone_verify_wrong_code, verificationFailureRes("code_not_entered"))
        assertEquals(R.string.phone_verify_expired, verificationFailureRes("expired"))
        assertEquals(R.string.phone_error_verify_call_failed, verificationFailureRes("twilio_13224"))
        assertEquals(R.string.phone_error_verify_call_failed, verificationFailureRes(null))
    }

    @Test fun theNoticeLanguageStartsWithTheAppLanguageWhenOffered() {
        val offered = listOf("en", "es", "fr")
        assertEquals("es", defaultCallLanguage("es-US", offered))
        assertEquals("fr", defaultCallLanguage("fr", offered))
        assertEquals("en", defaultCallLanguage("de-DE", offered))
        assertEquals("en", defaultCallLanguage("fr", listOf("en")))
    }

    @Test fun callEndsAndStatusesAreRead() {
        assertEquals(CallEndReason.COMPLETED, callEndReason(null))
        assertEquals(CallEndReason.BUSY, callEndReason(31486))
        assertEquals(CallEndReason.FAILED, callEndReason(31005))
        assertEquals(PhoneCallStatus.NO_ANSWER, PhoneCallStatus.fromWire("no_answer"))
        assertEquals(PhoneCallStatus.FAILED, PhoneCallStatus.fromWire("something new"))
        assertEquals("+1 (415) 555-0100", formatPhoneNumber("+14155550100"))
        assertEquals("+447700900123", formatPhoneNumber("+447700900123"))
    }

    @Test fun thePhoneTabIsShownPerAccountAndHiddenWhenSignedOut() {
        val prefs = FakeSharedPreferences()
        val state = PhoneAvailabilityState(prefs)
        assertFalse(state.enabled.value)
        state.switchTo("a")
        assertFalse(state.enabled.value)
        state.apply("a", true)
        assertTrue(state.enabled.value)
        state.switchTo(null)
        assertFalse(state.enabled.value)
        state.switchTo("b")
        assertFalse("another account does not inherit it", state.enabled.value)
        state.apply("a", true)
        assertFalse("a late answer for the previous account is ignored", state.enabled.value)
        state.switchTo("a")
        assertTrue("remembered for the same account", PhoneAvailabilityState(prefs).also { it.switchTo("a") }.enabled.value)
        state.apply("a", false)
        assertFalse(PhoneAvailabilityState(prefs).also { it.switchTo("a") }.enabled.value)
    }
}
