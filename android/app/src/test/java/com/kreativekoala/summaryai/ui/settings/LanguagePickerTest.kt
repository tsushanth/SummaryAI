package com.kreativekoala.summaryai.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Locale

/** The in-app language picker offers exactly the languages the Android 13+ system picker (xml/locales_config.xml) lists. */
class LanguagePickerTest {
    @Test fun pickerAndLocalesConfigListTheSameLanguages() {
        val text = File("src/main/res/xml/locales_config.xml").readText()
        val listed = Regex("android:name=\"([^\"]+)\"").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals(listed, SUPPORTED_LANGUAGE_TAGS.toSet())
        assertEquals("no duplicates in the picker", SUPPORTED_LANGUAGE_TAGS.size, SUPPORTED_LANGUAGE_TAGS.toSet().size)
    }

    @Test fun traditionalChineseIsOfferedForTaiwanAndHongKongAndNamedByScript() {
        assertTrue("zh-TW" in SUPPORTED_LANGUAGE_TAGS && "zh-HK" in SUPPORTED_LANGUAGE_TAGS && "zh-CN" in SUPPORTED_LANGUAGE_TAGS)
        assertEquals("繁體中文（台灣）", languageEndonym("zh-TW"))
        assertEquals("繁體中文（香港）", languageEndonym("zh-HK"))
        assertEquals("简体中文", languageEndonym("zh-CN"))
        assertEquals("Deutsch", languageEndonym("de"))
    }

    @Test fun aTraditionalChineseDeviceIsNeverMatchedToSimplified() {
        fun m(tag: String) = matchSupportedTag(Locale.forLanguageTag(tag))
        assertEquals("zh-TW", m("zh-TW"))
        assertEquals("zh-HK", m("zh-HK"))
        assertEquals("zh-TW", m("zh-Hant-TW"))
        assertEquals("zh-TW", m("zh-Hant"))
        assertEquals("zh-HK", m("zh-Hant-HK"))
        assertEquals("zh-HK", m("zh-Hant-MO"))
        assertEquals("zh-HK", m("zh-MO"))
        assertEquals("zh-CN", m("zh-CN"))
        assertEquals("zh-CN", m("zh-Hans-CN"))
        assertEquals("zh-CN", m("zh-SG"))
        assertEquals("zh-CN", m("zh"))
        assertEquals("pt-BR", m("pt-BR"))
        assertEquals("pt", m("pt-PT"))
        assertEquals("de", m("de-AT"))
        assertEquals(null, m("xx"))
    }
}
