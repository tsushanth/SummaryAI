package com.kreativekoala.summaryai.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MeetingLanguagesTest {
    @Test fun autoAndJunkNormalizeToAuto() {
        assertEquals("auto", MeetingLanguages.normalize(null))
        assertEquals("auto", MeetingLanguages.normalize(""))
        assertEquals("auto", MeetingLanguages.normalize("  "))
        assertEquals("auto", MeetingLanguages.normalize("AUTO"))
        assertEquals("auto", MeetingLanguages.normalize("klingon"))
        assertEquals("auto", MeetingLanguages.normalize("e"))
        assertEquals("auto", MeetingLanguages.normalize("1!"))
    }

    @Test fun regionTagsAndLegacyCodesReduceToTheBackendCode() {
        assertEquals("es", MeetingLanguages.normalize("es-MX"))
        assertEquals("pt", MeetingLanguages.normalize("pt_BR"))
        assertEquals("zh", MeetingLanguages.normalize("zh-CN"))
        assertEquals("en", MeetingLanguages.normalize(" EN "))
        // Android reports Indonesian as "in" and Hebrew as "iw"; the backend list uses id / he
        assertEquals("id", MeetingLanguages.normalize("in"))
        assertEquals("he", MeetingLanguages.normalize("iw"))
        assertEquals("no", MeetingLanguages.normalize("nb"))
    }

    @Test fun autoIsOmittedFromRequests_whenNoLanguageDefaultIsSaved() {
        assertNull(MeetingLanguages.requestValue("auto"))
        assertNull(MeetingLanguages.requestValue(null))
        assertNull(MeetingLanguages.requestValue("auto", serverDefault = "auto"))
        assertNull(MeetingLanguages.requestValue("auto", serverDefault = null))
        assertEquals("hi", MeetingLanguages.requestValue("hi"))
        assertEquals("hi", MeetingLanguages.requestValue("hi", serverDefault = "es"))
    }

    @Test fun autoIsSentExplicitly_whenTheSavedDefaultIsALanguage() {
        // omitting it would silently apply the saved default (backend: request > meeting > user default)
        assertEquals("auto", MeetingLanguages.requestValue("auto", serverDefault = "es"))
    }

    @Test fun fallbackListIsShortAndOnlyHasBackendCodes() {
        val backend = ("bg ca cs da de el en es et fi fr he hi hr hu id it ja ko lt lv ms nl no pl pt ro ru sk sv th tr uk vi zh").split(" ")
        val codes = MeetingLanguages.FALLBACK_OPTIONS.map { it.code }
        assertEquals(codes.size, codes.toSet().size)
        assertTrue(codes.size < backend.size)
        assertTrue("fallback has codes the backend rejects: ${codes - backend.toSet()}", backend.containsAll(codes))
        assertFalse("ar" in codes) // Recall lacks Arabic: the backend answers 400
        assertTrue(MeetingLanguages.FALLBACK_OPTIONS.all { it.nativeName.isNotBlank() })
    }

    @Test fun catalogLookups() {
        val c = LanguageCatalog.FALLBACK
        assertEquals("Español", c.nativeName("es-MX"))
        assertNull(c.nativeName("auto"))
        assertTrue(c.contains("auto"))
        assertTrue(c.contains("fr"))
        assertFalse(c.contains("ar"))
    }

    @Test fun delayHintOnlyForNonEnglishOnEnglishOnlyLowLatencyProviders() {
        val recall = LanguageCatalog.FALLBACK.copy(englishOnlyLowLatency = true, delayMinutes = "3-10", fromServer = true)
        assertTrue(recall.liveCaptionsDelayed("es"))
        assertFalse(recall.liveCaptionsDelayed("en"))
        assertFalse(recall.liveCaptionsDelayed("auto"))
        assertFalse(LanguageCatalog.FALLBACK.liveCaptionsDelayed("es"))
        assertFalse(recall.copy(englishOnlyLowLatency = false).liveCaptionsDelayed("es"))
    }
}
