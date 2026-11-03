package com.kreativekoala.summaryai.ui.meetings

import com.kreativekoala.summaryai.data.repository.LiveLanguageResult
import org.junit.Assert.assertEquals
import org.junit.Test

class LiveLanguageStateTest {
    @Test fun success_switchesActiveLanguage() {
        val (lang, notice) = applyLiveLanguageResult("auto", LiveLanguageResult.Success("es"))
        assertEquals("es", lang)
        assertEquals(LanguageNotice.Changed("es"), notice)
    }

    @Test fun conflict_keepsLanguage_andShowsNotSwitchable() {
        val (lang, notice) = applyLiveLanguageResult("fr", LiveLanguageResult.NotSwitchable)
        assertEquals("fr", lang)
        assertEquals(LanguageNotice.NotSwitchable, notice)
    }

    @Test fun failure_keepsLanguage() {
        val (lang, notice) = applyLiveLanguageResult("de", LiveLanguageResult.Failed("HTTP 500"))
        assertEquals("de", lang)
        assertEquals(LanguageNotice.Failed, notice)
    }
}
