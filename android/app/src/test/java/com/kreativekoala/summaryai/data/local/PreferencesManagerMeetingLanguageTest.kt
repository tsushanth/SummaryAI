package com.kreativekoala.summaryai.data.local

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PreferencesManagerMeetingLanguageTest {
    @get:Rule val tmp = TemporaryFolder()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @After fun tearDown() = scope.cancel()

    private fun manager(file: File = File(tmp.root, "prefs.preferences_pb")) =
        PreferencesManager(PreferenceDataStoreFactory.create(scope = scope) { file })

    @Test fun defaultsToAuto() = runBlocking {
        assertEquals("auto", manager().meetingLanguage.first())
    }

    @Test fun choiceIsRemembered_andRegionIsDropped() = runBlocking {
        val m = manager()
        m.setMeetingLanguage("es")
        assertEquals("es", m.meetingLanguage.first())
        m.setMeetingLanguage("fr-CA")
        assertEquals("fr", m.meetingLanguage.first())
        m.setMeetingLanguage("auto")
        assertEquals("auto", m.meetingLanguage.first())
    }

    @Test fun invalidValueFallsBackToAuto() = runBlocking {
        val m = manager()
        m.setMeetingLanguage("es")
        m.setMeetingLanguage("zzz")
        assertEquals("auto", m.meetingLanguage.first())
    }

    @Test fun lastMeetingLanguage_isPerMeeting() = runBlocking {
        val m = manager()
        assertNull(m.lastMeetingLanguageFor("m1").first())
        m.setLastMeetingLanguage("m1", "de")
        assertEquals("de", m.lastMeetingLanguageFor("m1").first())
        assertNull(m.lastMeetingLanguageFor("m2").first())
        m.setLastMeetingLanguage("m2", "auto")
        assertEquals("auto", m.lastMeetingLanguageFor("m2").first())
        assertNull(m.lastMeetingLanguageFor("m1").first())
    }
}
