package com.kreativekoala.summaryai.data.repository

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.coaching.CoachingStartSessionRequest
import com.kreativekoala.summaryai.data.api.models.AskQuestionRequest
import com.kreativekoala.summaryai.data.api.models.AskQuestionResponse
import com.kreativekoala.summaryai.data.api.models.CreateRecordingRequest
import com.kreativekoala.summaryai.data.sample.SampleMeetingStore
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import com.kreativekoala.summaryai.util.OutputLanguageSource
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.lang.reflect.Proxy

/** The language reaches the server: in the create-recording body, the question body and the coaching start body. */
class OutputLanguageRequestsTest {
    private val gson = Gson()

    @Test fun createRecordingSendsOutputLanguageWhenKnown() {
        val json = gson.toJson(CreateRecordingRequest("t", 10, 100L, outputLanguage = "th"))
        assertTrue(json, json.contains("\"output_language\":\"th\""))
    }

    @Test fun createRecordingOmitsItWhenUnknownSoTheServerDefaultApplies() {
        val json = gson.toJson(CreateRecordingRequest("t", 10, 100L))
        assertFalse(json, json.contains("output_language"))
    }

    @Test fun questionAndCoachingBodiesUseTheSameField() {
        assertTrue(gson.toJson(AskQuestionRequest("q", "vi")).contains("\"output_language\":\"vi\""))
        assertTrue(gson.toJson(CoachingStartSessionRequest("r", "sales_discovery", "ja")).contains("\"output_language\":\"ja\""))
        assertFalse(gson.toJson(AskQuestionRequest("q")).contains("output_language"))
        assertFalse(gson.toJson(CoachingStartSessionRequest("r", "sales_discovery")).contains("output_language"))
    }

    @Test fun askQuestionPassesTheResolvedLanguageToTheApi() = runBlocking {
        var seen: AskQuestionRequest? = null
        val api = Proxy.newProxyInstance(SummaryAIApi::class.java.classLoader, arrayOf(SummaryAIApi::class.java)) { _, method, args ->
            if (method.name == "askQuestion") {
                seen = args[1] as AskQuestionRequest
                AskQuestionResponse("answer", null)
            } else throw AssertionError("unexpected ${method.name}")
        } as SummaryAIApi
        val store = SampleMeetingStore(FakeSharedPreferences())
        val withLanguage = RecordingsRepository(api, OkHttpClient(), store, OutputLanguageSource { "tr" })
        assertEquals("answer", withLanguage.askQuestion("rec-1", "ne karar alindi?").getOrThrow())
        assertEquals("tr", seen!!.outputLanguage)

        val without = RecordingsRepository(api, OkHttpClient(), store, OutputLanguageSource { null })
        without.askQuestion("rec-1", "q").getOrThrow()
        assertEquals(null, seen!!.outputLanguage)
    }
}
