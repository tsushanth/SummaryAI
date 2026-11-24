package com.kreativekoala.summaryai.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OutputLanguageTest {
    @Test fun autoAndEmptySendNothingSoTheServerFollowsTheTranscript() {
        for (v in listOf("auto", "AUTO", "", "  ", null)) assertNull(v, OutputLanguage.resolve(v))
    }

    @Test fun anExplicitPreferenceIsSent() {
        assertEquals("de", OutputLanguage.resolve("de"))
        assertEquals("pt-BR", OutputLanguage.resolve("pt-BR"))
        assertEquals("id", OutputLanguage.resolve("in"))
    }

    @Test fun regionAndScriptAreKeptButExtensionsAreDropped() {
        assertEquals("zh-CN", OutputLanguage.normalize("zh-CN"))
        assertEquals("zh-Hant-TW", OutputLanguage.normalize("zh-Hant-TW"))
        assertEquals("zh-TW", OutputLanguage.normalize("zh-TW"))
        assertEquals("zh-HK", OutputLanguage.resolve("zh_HK"))
        assertEquals("en-US", OutputLanguage.normalize("en_US"))
        assertEquals("en", OutputLanguage.normalize("en-u-ca-gregory"))
    }

    @Test fun legacyJavaCodesBecomeCurrentOnes() {
        assertEquals("id", OutputLanguage.normalize("in"))
        assertEquals("id", OutputLanguage.normalize("in-ID").orEmpty().substringBefore('-'))
    }

    @Test fun nothingUsableMeansNothingIsSent() {
        assertNull(OutputLanguage.resolve("und"))
        assertNull(OutputLanguage.normalize("und"))
        assertNull(OutputLanguage.normalize("auto"))
    }
}
