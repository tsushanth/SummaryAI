package com.kreativekoala.summaryai.ui.search

import com.kreativekoala.summaryai.data.api.models.SearchHitDto
import com.kreativekoala.summaryai.data.api.models.SearchRecordingDto
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.RecordingStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class SearchMergeTest {
    private fun rec(id: String, title: String) = Recording(
        id = id, title = title, durationSeconds = 1, status = RecordingStatus.COMPLETED,
        audioUrl = null, createdAt = "2026-10-01T00:00:00Z",
    )

    private fun hit(id: String, title: String?, status: String? = "completed") = SearchHitDto(
        recording = SearchRecordingDto(id = id, title = title, status = status, tags = listOf("a"), isFavorite = true),
        match = "transcript",
        snippet = "...",
    )

    @Test
    fun serverHitsBeyondTheLoadedPagesAreIncluded() {
        val loaded = listOf(rec("1", "Budget review"), rec("2", "Standup"))
        val out = mergeSearchResults("budget", loaded, listOf(hit("1", "Budget review"), hit("999", "Old planning")))
        assertEquals(listOf("1", "999"), out.map { it.id })
        val remote = out.last()
        assertEquals("Old planning", remote.title)
        assertEquals(listOf("a"), remote.tags)
        assertEquals(true, remote.isFavorite)
    }

    @Test
    fun loadedCopyWinsAndNothingIsDuplicated() {
        val loaded = listOf(rec("1", "Alpha"), rec("2", "Standup notes"))
        val out = mergeSearchResults("alpha", loaded, listOf(hit("2", "Standup notes"), hit("1", "Alpha")))
        assertEquals(listOf("1", "2"), out.map { it.id })
        assertEquals("Standup notes", out[1].title)
    }

    @Test
    fun unknownStatusAndMissingTitleFallBackSafely() {
        val out = mergeSearchResults("zzz", emptyList(), listOf(hit("5", null, status = "weird")))
        assertEquals("Recording", out[0].title)
        assertEquals(RecordingStatus.COMPLETED, out[0].status)
    }
}
