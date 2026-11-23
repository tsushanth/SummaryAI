package com.kreativekoala.summaryai.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OutputLanguageTest {
    @Test fun autoFollowsTheAppLanguage() {
        assertEquals("th", OutputLanguage.resolve("auto", "th"))
        assertEquals("th", OutputLanguage.resolve("AUTO", "th"))
        assertEquals("th", OutputLanguage.resolve("", "th"))
        assertEquals("th", OutputLanguage.resolve(null, "th"))
        assertEquals("th", OutputLanguage.resolve("  ", "th"))
    }

    @Test fun anExplicitPreferenceWinsOverTheAppLanguage() {
        assertEquals("de", OutputLanguage.resolve("de", "th"))
        assertEquals("pt-BR", OutputLanguage.resolve("pt-BR", "en"))
    }

    @Test fun regionAndScriptAreKeptButExtensionsAreDropped() {
        assertEquals("zh-CN", OutputLanguage.normalize("zh-CN"))
        assertEquals("zh-Hant-TW", OutputLanguage.normalize("zh-Hant-TW"))
        assertEquals("en-US", OutputLanguage.normalize("en_US"))
        assertEquals("en", OutputLanguage.normalize("en-u-ca-gregory"))
    }

    @Test fun legacyJavaCodesBecomeCurrentOnes() {
        assertEquals("id", OutputLanguage.normalize("in"))
        assertEquals("id", OutputLanguage.normalize("in-ID").orEmpty().substringBefore('-'))
    }

    @Test fun nothingUsableMeansNothingIsSent() {
        assertNull(OutputLanguage.resolve("auto", null))
        assertNull(OutputLanguage.resolve("auto", ""))
        assertNull(OutputLanguage.normalize("und"))
        assertNull(OutputLanguage.normalize("auto"))
    }
}
