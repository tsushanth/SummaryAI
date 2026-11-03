package com.kreativekoala.summaryai.ui.meetings

import com.kreativekoala.summaryai.data.repository.LiveLanguageConflict
import com.kreativekoala.summaryai.data.repository.LiveLanguageResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LiveLanguageStateTest {
    @Test fun success_switchesActiveLanguage() {
        val o = applyLiveLanguageResult("auto", LiveLanguageResult.Success("es"))
        assertEquals("es", o.language)
        assertEquals(LanguageNotice.Changed("es"), o.notice)
        assertNull(o.blockedReason)
    }

    @Test fun savedButNotAppliedLive_isReportedHonestly() {
        val o = applyLiveLanguageResult("auto", LiveLanguageResult.Success("es", liveApplied = false))
        assertEquals("es", o.language)
        assertEquals(LanguageNotice.SavedNotLive("es"), o.notice)
    }

    @Test fun fixedConflict_keepsLanguage_hidesTheButton() {
        val o = applyLiveLanguageResult("fr", LiveLanguageResult.NotSwitchable(LiveLanguageConflict.FIXED))
        assertEquals("fr", o.language)
        assertEquals(LanguageNotice.NotSwitchable, o.notice)
        assertEquals("provider_fixed", o.blockedReason)
    }

    @Test fun notLiveConflict_hasItsOwnMessage() {
        val o = applyLiveLanguageResult("fr", LiveLanguageResult.NotSwitchable(LiveLanguageConflict.NOT_LIVE))
        assertEquals("fr", o.language)
        assertEquals(LanguageNotice.NotLive, o.notice)
        assertEquals("not_live", o.blockedReason)
    }

    @Test fun failure_keepsLanguage_andDoesNotBlock() {
        val o = applyLiveLanguageResult("de", LiveLanguageResult.Failed("HTTP 500"))
        assertEquals("de", o.language)
        assertEquals(LanguageNotice.Failed, o.notice)
        assertNull(o.blockedReason)
    }
}
