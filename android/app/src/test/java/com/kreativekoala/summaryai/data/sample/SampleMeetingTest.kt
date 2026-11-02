package com.kreativekoala.summaryai.data.sample

import com.kreativekoala.summaryai.data.repository.RecordingsFilter
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SampleMeetingTest {
    private val detail = SampleMeeting.detail("2026-11-02T10:00:00")

    // ---- content ---------------------------------------------------------------------------

    @Test fun sampleIsALabelledCompletedLocalRecording() {
        val r = detail.recording
        assertEquals(SampleMeeting.ID, r.id)
        assertEquals("Sample meeting", r.title)
        assertEquals(RecordingStatus.COMPLETED, r.status)
        assertNull("no audio is bundled or downloaded", r.audioUrl)
        assertTrue("two minutes or less", r.durationSeconds in 60..120)
        assertTrue(SampleMeeting.isSample(r.id))
        assertFalse(SampleMeeting.isSample("0b8f-real-id"))
    }

    @Test fun summaryHasEnoughToShowWhatTheProductProduces() {
        val s = detail.summary!!
        assertTrue(s.keyPoints.size >= 5)
        assertTrue(s.actionItems.size >= 3)
        assertTrue(s.topics.isNotEmpty())
        assertTrue(s.shortSummary.isNotBlank())
        assertNotNull(s.detailedSummary)
        // every action item names an owner from the meeting
        val owners = setOf("Maya", "Dev", "Priya", "Tomas")
        s.actionItems.forEach { item -> assertTrue("no owner in: $item", owners.any { item.startsWith("$it:") }) }
    }

    @Test fun transcriptIsAFourPersonSyncThatFitsInTwoMinutes() {
        val t = detail.transcript!!
        assertEquals(4, t.segments.map { it.speaker }.toSet().size)
        assertEquals(mapOf("0" to "Maya", "1" to "Dev", "2" to "Priya", "3" to "Tomas"), t.speakerNames)
        assertTrue(t.segments.last().endTime <= 120.0)
        assertTrue(t.segments.zipWithNext().all { (a, b) -> a.endTime <= b.startTime && a.startTime < a.endTime })
        assertEquals(t.fullText.split(Regex("\\s+")).size, t.wordCount)
        assertFalse(t.hasNoSpeech)
        assertTrue(t.wordCount in 150..400)
    }

    @Test fun contentUsesFictionalPeopleAndNoRealBrandsOrContactDetails() {
        val all = buildString {
            append(detail.recording.title)
            detail.summary!!.let { append(it.shortSummary); append(it.detailedSummary); it.keyPoints.forEach(::append); it.actionItems.forEach(::append); it.topics.forEach(::append) }
            append(detail.transcript!!.fullText)
        }.lowercase()
        listOf("google", "apple", "microsoft", "zoom", "slack", "teams", "otter", "fathom", "notion", "meta", "amazon", "@", "http", "www.", ".com")
            .forEach { assertFalse("sample must not mention $it", all.contains(it)) }
    }

    // ---- visibility store --------------------------------------------------------------------

    @Test fun storeSeedsOnceAndDeleteIsPermanent() {
        var now = 1_700_000_000_000L
        val prefs = FakeSharedPreferences()
        val store = SampleMeetingStore(prefs) { now }
        assertFalse("existing users are never seeded", store.isVisible)
        store.seed()
        assertTrue(store.isVisible)
        val created = store.createdAt()
        now += 86_400_000
        store.seed()
        assertEquals("seeding again must not move the date", created, store.createdAt())
        store.dismiss()
        assertFalse(store.isVisible)
        store.seed()
        assertFalse("a deleted sample never comes back", store.isVisible)
        assertFalse("survives a restart", SampleMeetingStore(prefs) { now }.isVisible)
    }

    // ---- list merge --------------------------------------------------------------------------

    private fun rec(id: String) = Recording(id, "r$id", 30, RecordingStatus.COMPLETED, null, "2026-11-01T10:00:00")

    @Test fun sampleIsAppendedToTheFirstUnfilteredPage() {
        val out = SampleMeeting.mergeIntoList(listOf(rec("1")), page = 1, status = null, filter = RecordingsFilter(), visible = true, createdAt = "2026-11-02T10:00:00")
        assertEquals(listOf("1", SampleMeeting.ID), out.map { it.id })
        assertEquals("2026-11-02T10:00:00", out.last().createdAt)
    }

    @Test fun sampleAloneFillsAnEmptyAccount() {
        val out = SampleMeeting.mergeIntoList(emptyList(), 1, null, RecordingsFilter(), true, "2026-11-02T10:00:00")
        assertEquals(listOf(SampleMeeting.ID), out.map { it.id })
    }

    @Test fun sampleIsHiddenWhenNotVisibleFilteredPagedOrCrowded() {
        val base = listOf(rec("1"))
        val c = "2026-11-02T10:00:00"
        assertEquals(base, SampleMeeting.mergeIntoList(base, 1, null, RecordingsFilter(), false, c))
        assertEquals(base, SampleMeeting.mergeIntoList(base, 2, null, RecordingsFilter(), true, c))
        assertEquals(base, SampleMeeting.mergeIntoList(base, 1, com.kreativekoala.summaryai.data.api.models.RecordingStatus.COMPLETED, RecordingsFilter(), true, c))
        assertEquals(base, SampleMeeting.mergeIntoList(base, 1, null, RecordingsFilter(favorite = true), true, c))
        assertEquals(base, SampleMeeting.mergeIntoList(base, 1, null, RecordingsFilter(folderId = "f"), true, c))
        assertEquals(base, SampleMeeting.mergeIntoList(base, 1, null, RecordingsFilter(tag = "t"), true, c))
        assertEquals(base, SampleMeeting.mergeIntoList(base, 1, null, RecordingsFilter(recordingType = "meeting"), true, c))
        val crowded = (1..19).map { rec("$it") }
        assertEquals("a full first page must not tip hasMore", crowded, SampleMeeting.mergeIntoList(crowded, 1, null, RecordingsFilter(), true, c))
    }

    @Test fun sampleIsNotDuplicatedOnRepeatedMerge() {
        val c = "2026-11-02T10:00:00"
        val once = SampleMeeting.mergeIntoList(emptyList(), 1, null, RecordingsFilter(), true, c)
        val twice = SampleMeeting.mergeIntoList(once, 1, null, RecordingsFilter(), true, c)
        assertEquals(1, twice.count { it.id == SampleMeeting.ID })
    }
}
