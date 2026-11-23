package com.kreativekoala.summaryai.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/** The in-app language picker offers exactly the languages the Android 13+ system picker (xml/locales_config.xml) lists. */
class LanguagePickerTest {
    @Test fun pickerAndLocalesConfigListTheSameLanguages() {
        val text = File("src/main/res/xml/locales_config.xml").readText()
        val listed = Regex("android:name=\"([^\"]+)\"").findAll(text).map { it.groupValues[1] }.toSet()
        assertEquals(listed, SUPPORTED_LANGUAGE_TAGS.toSet())
        assertEquals("no duplicates in the picker", SUPPORTED_LANGUAGE_TAGS.size, SUPPORTED_LANGUAGE_TAGS.toSet().size)
    }
}
