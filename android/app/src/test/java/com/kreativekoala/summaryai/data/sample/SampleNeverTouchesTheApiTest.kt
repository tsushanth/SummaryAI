package com.kreativekoala.summaryai.data.sample

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.repository.RecordingsRepository
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Proxy

/** "Never uploaded or billed": every repository call for the sample id is answered locally, with no API call. */
class SampleNeverTouchesTheApiTest {
    private val api: SummaryAIApi = Proxy.newProxyInstance(
        SummaryAIApi::class.java.classLoader, arrayOf(SummaryAIApi::class.java)
    ) { _, method, _ -> throw AssertionError("the sample must not call the API: ${method.name}") } as SummaryAIApi

    private val store = SampleMeetingStore(FakeSharedPreferences()).also { it.seed() }
    private val repo = RecordingsRepository(api, OkHttpClient(), store)

    @Test fun openingTheSampleIsLocal() = runBlocking {
        val r = repo.getRecording(SampleMeeting.ID, includeTranscript = true, includeSummary = true)
        assertTrue(r.isSuccess)
        assertEquals("Sample meeting", r.getOrThrow().recording.title)
        assertTrue(r.getOrThrow().summary!!.actionItems.isNotEmpty())
    }

    @Test fun deletingTheSampleHidesItForGoodWithoutTheApi() = runBlocking {
        assertTrue(store.isVisible)
        assertTrue(repo.deleteRecording(SampleMeeting.ID).isSuccess)
        assertFalse(store.isVisible)
    }

    @Test fun questionsAboutTheSampleAreAnsweredLocally() = runBlocking {
        val r = repo.askQuestion(SampleMeeting.ID, "Who owns the sync fix?")
        assertEquals(SampleMeeting.QA_LOCKED_MESSAGE, r.getOrThrow())
    }

    @Test fun editsToTheSampleAreRefusedLocally() = runBlocking {
        assertTrue(repo.toggleFavorite(SampleMeeting.ID, true).isFailure)
        assertTrue(repo.renameRecording(SampleMeeting.ID, "x").isFailure)
        assertTrue(repo.updateSpeakerNames(SampleMeeting.ID, mapOf("0" to "x")).isFailure)
    }

    @Test fun pollingTheSampleEmitsOnceAndStops() = runBlocking {
        val emitted = repo.pollRecordingStatus(SampleMeeting.ID).toList()
        assertEquals(1, emitted.size)
    }
}
