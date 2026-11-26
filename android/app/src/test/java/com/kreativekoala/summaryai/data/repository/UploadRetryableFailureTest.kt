package com.kreativekoala.summaryai.data.repository

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.CreateRecordingResponse
import com.kreativekoala.summaryai.data.sample.SampleMeetingStore
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import com.kreativekoala.summaryai.util.OutputLanguageSource
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.lang.reflect.Proxy

/** A failed storage PUT keeps the file and says whether it should be sent again by itself. */
class UploadRetryableFailureTest {
    @get:Rule val folder = TemporaryFolder()
    private val server = MockWebServer()

    @Before fun setUp() = server.start()
    @After fun tearDown() = server.shutdown()

    /** Uploads one file with storage answering [status] to every PUT; returns how often a later retry was asked for. */
    private fun uploadAgainst(status: Int, puts: Int): Int = runBlocking {
        repeat(puts) { server.enqueue(MockResponse().setResponseCode(status)) }
        val created = Gson().fromJson(
            """{"recording":{"id":"r1","user_id":"u","status":"uploading"},
               "upload":{"url":"${server.url("/put")}","method":"PUT","headers":{}}}""",
            CreateRecordingResponse::class.java,
        )
        val api = Proxy.newProxyInstance(SummaryAIApi::class.java.classLoader, arrayOf(SummaryAIApi::class.java)) { _, method, _ ->
            if (method.name == "createRecording") created else throw AssertionError("unexpected ${method.name}")
        } as SummaryAIApi
        val repo = RecordingsRepository(api, OkHttpClient(), SampleMeetingStore(FakeSharedPreferences()), OutputLanguageSource { null })
        val audio = folder.newFile("recording_a.m4a").apply { writeText("audio") }

        var asked = 0
        val result = repo.uploadRecording("t", audio, 31, onRetryableFailure = { asked++ })

        assertTrue(result.isFailure)
        assertTrue("the file is kept", audio.exists())
        assertEquals(puts, server.requestCount)
        asked
    }

    @Test fun `a gateway timeout after all attempts asks for a later retry`() {
        assertEquals(1, uploadAgainst(status = 504, puts = 3))
    }

    @Test fun `a rejected upload does not`() {
        assertEquals(0, uploadAgainst(status = 403, puts = 1))
    }
}
