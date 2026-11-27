package com.kreativekoala.summaryai.ui.recordings

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.models.TranscriptDto
import com.kreativekoala.summaryai.data.repository.toDomain
import com.kreativekoala.summaryai.data.sample.SampleMeeting
import com.kreativekoala.summaryai.domain.model.TranscriptSegment
import com.kreativekoala.summaryai.ui.recordings.share.applyingSpeakerNames
import com.kreativekoala.summaryai.ui.recordings.share.participantName
import com.kreativekoala.summaryai.ui.recordings.share.speakerDisplayLabel
import com.kreativekoala.summaryai.ui.recordings.share.speakerKey
import com.kreativekoala.summaryai.ui.recordings.share.speakerNumber
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpeakerNamesTest {
    /** The shape GET /api/recordings/:id sends. */
    private val serverTranscript = """
        {"segments":[
          {"id":"a","speaker_label":"Speaker 0","speaker_index":0,"text":"Hello speaker 2","start_time":0,"end_time":2},
          {"id":"b","speaker_label":"Speaker 1","speaker_index":1,"text":"Hi","start_time":2,"end_time":3}
        ],"speaker_names":{"1":"Blake"}}
    """

    private fun shown(segments: List<TranscriptSegment>, names: Map<String, String>?) =
        segments.map { speakerDisplayLabel(it.speaker, it.speakerIndex, names) }

    @Test fun `the server's speaker fields reach the transcript`() {
        val t = Gson().fromJson(serverTranscript, TranscriptDto::class.java).toDomain()
        assertEquals(listOf("Speaker 0", "Speaker 1"), t.segments.map { it.speaker })
        assertEquals(listOf(0, 1), t.segments.map { it.speakerIndex })
        assertEquals(listOf("Speaker 1", "Blake"), shown(t.segments, t.speakerNames))
    }

    @Test fun `renamed speakers show their names and the rest count from 1`() {
        assertEquals("Alex", speakerDisplayLabel("Speaker 0", 0, mapOf("0" to "Alex", "1" to "Blake")))
        assertEquals("Speaker 2", speakerDisplayLabel("Speaker 1", 1, mapOf("0" to "Alex")))
        assertEquals("a blank name is no name", "Speaker 1", speakerDisplayLabel("Speaker 0", 0, mapOf("0" to "  ")))
    }

    @Test fun `labels that are not generated stay, unless renamed`() {
        assertEquals("Jordan Lee", speakerDisplayLabel("Jordan Lee", 0, null))
        assertEquals("JL", speakerDisplayLabel("Jordan Lee", 0, mapOf("0" to "JL")))
        assertEquals("Document", speakerDisplayLabel("Document", 0, null))
        assertEquals("a bot participant id", "Speaker 100", speakerDisplayLabel("Speaker 100", 0, null))
        assertEquals("already counted from 1", "Speaker 1", speakerDisplayLabel("Speaker 1", 0, null))
        assertEquals("Part 2 speaker 1", speakerDisplayLabel("Part 2 speaker 0", 3, null))
        assertEquals("Speaker 3", speakerDisplayLabel(null, 2, null))
        assertNull(speakerDisplayLabel(null, null, null))
    }

    @Test fun `summary mentions use the stored index and are shown from 1`() {
        assertEquals("Assigned to Speaker 2", "Assigned to Speaker 1".applyingSpeakerNames(null))
        assertEquals("Alex asked Speaker 2.", "Speaker 0 asked Speaker 1.".applyingSpeakerNames(mapOf("0" to "Alex")))
        assertEquals("Blake will send it", "Speaker 1 (Blake) will send it".applyingSpeakerNames(mapOf("1" to "Blake")))
    }

    // The same cases as backend/test/speakers.test.ts and web scripts/export.test.mjs.
    @Test fun `lists and recordings transcribed in parts`() {
        assertEquals("Speakers 1 and 2 agreed.", "Speakers 0 and 1 agreed.".applyingSpeakerNames(null))
        assertEquals("Speakers 1, 2, and 3 met.", "Speakers 0, 1, and 2 met.".applyingSpeakerNames(emptyMap()))
        assertEquals("Ana and Speaker 2 agreed.", "Speakers 0 and 1 agreed.".applyingSpeakerNames(mapOf("0" to "Ana")))
        assertEquals("Part 2 speaker 1 left.", "Part 2 speaker 0 left.".applyingSpeakerNames(mapOf("0" to "Ana")))
    }

    @Test fun `the rename sheet numbers from 1 and keeps the stored key`() {
        val t = Gson().fromJson(serverTranscript, TranscriptDto::class.java).toDomain()
        assertEquals(listOf("0", "1"), t.segments.mapNotNull(::speakerKey))
        assertEquals("1", speakerNumber("0"))
        assertNull(participantName(t.segments, "0"))
        val bot = listOf(TranscriptSegment(0.0, 1.0, "x", "Jordan Lee", 0))
        assertEquals("Jordan Lee", participantName(bot, "0"))
    }

    @Test fun `the sample meeting shows each line under the person who says it`() {
        val t = SampleMeeting.detail("2026-11-02T10:00:00").transcript!!
        val speakers = shown(t.segments, t.speakerNames)
        assertEquals(listOf("Maya", "Dev", "Priya", "Maya", "Priya", "Tomas"), speakers.take(6))
        // "Priya, can you mock that up" is Maya speaking; the reply is Priya's.
        assertEquals("Maya", speakers[t.segments.indexOfFirst { it.text.startsWith("Agreed. Priya") }])
        assertEquals("Tomas", speakers[t.segments.indexOfFirst { it.text.startsWith("Will do") }])
    }
}
