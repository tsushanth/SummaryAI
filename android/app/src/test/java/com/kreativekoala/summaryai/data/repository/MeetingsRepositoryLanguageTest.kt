package com.kreativekoala.summaryai.data.repository

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.JoinMeetingRequest
import com.kreativekoala.summaryai.data.api.models.JoinMeetingResponse
import com.kreativekoala.summaryai.data.api.models.LiveLanguageRequest
import com.kreativekoala.summaryai.data.api.models.MeetingDto
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response
import java.io.IOException
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy

class MeetingsRepositoryLanguageTest {
    private val gson = Gson()
    private val json = "application/json".toMediaType()

    // ----- request building -----

    @Test fun autoLeavesTheJoinBodyUnchanged() {
        val body = gson.toJsonTree(buildJoinRequest("https://zoom.us/j/1", "Bot", "auto")).asJsonObject
        assertFalse(body.has("transcription_language"))
        assertEquals("""{"join_url":"https://zoom.us/j/1","bot_name":"Bot"}""", body.toString())
        // identical to what builds before this feature sent
        assertEquals(
            gson.toJson(JoinMeetingRequest(joinUrl = "https://zoom.us/j/1", botName = "Bot")),
            gson.toJson(buildJoinRequest("https://zoom.us/j/1", "Bot", "auto"))
        )
    }

    @Test fun chosenLanguageIsSentAsPrimarySubtag() {
        val body = gson.toJsonTree(buildJoinRequest("https://meet.google.com/a", null, "hi")).asJsonObject
        assertEquals("hi", body.get("transcription_language").asString)
        val regional = gson.toJsonTree(buildJoinRequest("https://meet.google.com/a", null, "pt-BR")).asJsonObject
        assertEquals("pt", regional.get("transcription_language").asString)
    }

    @Test fun repositorySendsChosenLanguageOnJoin_andOmitsItForAuto() = runBlocking {
        val sent = mutableListOf<JoinMeetingRequest>()
        val api = fakeApi { method, args ->
            if (method == "joinMeeting") {
                sent += args[0] as JoinMeetingRequest
                JoinMeetingResponse(MeetingDto(id = "m1", status = "bot_joining"), botId = "b", recordingId = "r")
            } else error("unexpected $method")
        }
        val repo = MeetingsRepository(api)
        assertTrue(repo.joinMeeting("https://zoom.us/j/1", null, "auto").isSuccess)
        assertTrue(repo.joinMeeting("https://zoom.us/j/1", null, "ja").isSuccess)
        assertEquals(null, sent[0].transcriptionLanguage)
        assertEquals("ja", sent[1].transcriptionLanguage)
    }

    // ----- live-language response handling -----

    @Test fun http409MeansNotSwitchable() {
        assertEquals(LiveLanguageResult.NotSwitchable, mapLiveLanguageResponse(409, """{"error":"x"}""", "es"))
    }

    @Test fun success_usesEchoedLanguageElseRequested() {
        assertEquals(LiveLanguageResult.Success("fr"), mapLiveLanguageResponse(200, """{"language":"fr"}""", "es"))
        assertEquals(LiveLanguageResult.Success("es"), mapLiveLanguageResponse(200, "", "es"))
        assertEquals(LiveLanguageResult.Success("es"), mapLiveLanguageResponse(204, null, "es"))
        assertEquals(LiveLanguageResult.Success("es"), mapLiveLanguageResponse(200, "not json", "es"))
    }

    @Test fun otherErrorsFail() {
        assertTrue(mapLiveLanguageResponse(400, """{"error":"bad"}""", "es") is LiveLanguageResult.Failed)
        assertTrue(mapLiveLanguageResponse(500, null, "es") is LiveLanguageResult.Failed)
        assertTrue(mapLiveLanguageResponse(404, null, "es") is LiveLanguageResult.Failed)
    }

    @Test fun repository_409_isNotAnException() = runBlocking {
        val api = fakeApi { _, _ -> Response.error<ResponseBody>(409, """{"error":"cannot"}""".toResponseBody(json)) }
        assertEquals(LiveLanguageResult.NotSwitchable, MeetingsRepository(api).setLiveLanguage("m1", "es"))
    }

    @Test fun repository_postsNormalizedLanguage_andReturnsSuccess() = runBlocking {
        var posted: LiveLanguageRequest? = null
        val api = fakeApi { _, args ->
            posted = args[1] as LiveLanguageRequest
            Response.success("""{"language":"es"}""".toResponseBody(json))
        }
        val result = MeetingsRepository(api).setLiveLanguage("m1", "es-MX")
        assertEquals("es", posted?.language)
        assertEquals(LiveLanguageResult.Success("es"), result)
    }

    @Test fun repository_networkErrorFails() = runBlocking {
        val api = fakeApi { _, _ -> throw IOException("offline") }
        assertTrue(MeetingsRepository(api).setLiveLanguage("m1", "es") is LiveLanguageResult.Failed)
    }

    // ----- fake api (the interface is large; only the methods under test are answered) -----

    private fun fakeApi(handler: (method: String, args: List<Any?>) -> Any?): SummaryAIApi {
        val loader = SummaryAIApi::class.java.classLoader
        return Proxy.newProxyInstance(loader, arrayOf(SummaryAIApi::class.java)) { _, method, args ->
            // suspend functions carry a trailing Continuation; pass the rest to the handler
            val real = (args ?: emptyArray()).dropLast(1)
            try {
                handler(method.name, real)
            } catch (e: InvocationTargetException) {
                throw e.targetException
            }
        } as SummaryAIApi
    }
}
