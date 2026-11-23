package com.kreativekoala.summaryai.util

import com.kreativekoala.summaryai.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerTextTest {
    @Test fun callTitlesAreRecognised() {
        assertEquals(R.string.server_title_call_with to "Maria Lopez", ServerText.titleMatch("Call with Maria Lopez"))
        assertEquals(R.string.server_title_call_to to "+14155550100", ServerText.titleMatch("Call to +14155550100"))
    }

    @Test fun otherTitlesAreLeftAlone() {
        assertNull(ServerText.titleMatch("Weekly sync"))
        assertNull(ServerText.titleMatch("Call with"))
        assertNull(ServerText.titleMatch("My Call with Bob"))
    }

    @Test fun generatedSpeakerLabelsAreRecognised() {
        assertEquals(R.string.server_speaker_numbered to 2, ServerText.speakerMatch("Speaker 2"))
        assertEquals(R.string.server_speaker_numbered to 0, ServerText.speakerMatch("Speaker 0"))
    }

    @Test fun realNamesAreNotSpeakerLabels() {
        assertNull(ServerText.speakerMatch("Alex"))
        assertNull(ServerText.speakerMatch("Speaker 2 (Alex)"))
        assertNull(ServerText.speakerMatch("Speaker"))
    }
}
