package com.kreativekoala.summaryai.data.repository

import com.google.gson.Gson
import com.kreativekoala.summaryai.data.MeetingLanguages
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.JoinMeetingRequest
import com.kreativekoala.summaryai.data.api.models.JoinMeetingResponse
import com.kreativekoala.summaryai.data.api.models.LiveLanguageRequest
import com.kreativekoala.summaryai.data.api.models.MeetingDto
import com.kreativekoala.summaryai.data.api.models.MeetingResponse
import com.kreativekoala.summaryai.data.api.models.UpdateMeetingRequest
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
        val body = gson.toJsonTree(buildJoinRequest("https://zoom.us/j/1", "Bot", MeetingLanguages.requestValue("auto"))).asJsonObject
        assertFalse(body.has("transcription_language"))
        assertEquals("""{"join_url":"https://zoom.us/j/1","bot_name":"Bot"}""", body.toString())
        // identical to what builds before this feature sent
        assertEquals(
            gson.toJson(JoinMeetingRequest(joinUrl = "https://zoom.us/j/1", botName = "Bot")),
            gson.toJson(buildJoinRequest("https://zoom.us/j/1", "Bot", MeetingLanguages.requestValue("auto")))
        )
    }

    @Test fun chosenLanguageIsSentAsPrimarySubtag() {
        val body = gson.toJsonTree(buildJoinRequest("https://meet.google.com/a", null, "hi")).asJsonObject
        assertEquals("hi", body.get("transcription_language").asString)
        val regional = gson.toJsonTree(buildJoinRequest("https://meet.google.com/a", null, "pt-BR")).asJsonObject
        assertEquals("pt", regional.get("transcription_language").asString)
    }

    @Test fun explicitAutoIsSent_whenTheSavedDefaultIsALanguage() {
        val value = MeetingLanguages.requestValue("auto", serverDefault = "es")
        val body = gson.toJsonTree(buildJoinRequest("https://zoom.us/j/1", null, value)).asJsonObject
        assertEquals("auto", body.get("transcription_language").asString)
    }

    @Test fun patchBody_hasLanguageOnlyWhenGiven_andAutoIsExplicit() = runBlocking {
        val sent = mutableListOf<UpdateMeetingRequest>()
        val api = fakeApi { method, args ->
            assertEquals("updateMeeting", method)
            sent += args[1] as UpdateMeetingRequest
            MeetingResponse(MeetingDto(id = "m1", status = "scheduled", transcriptionLanguage = "ja"))
        }
        val repo = MeetingsRepository(api)
        val toggled = repo.updateMeeting("m1", autoJoin = true).getOrThrow()
        repo.updateMeeting("m1", transcriptionLanguage = "ja")
        repo.updateMeeting("m1", transcriptionLanguage = "auto")
        // the existing auto-join toggle body does not change
        assertEquals("""{"auto_join":true}""", gson.toJson(sent[0]))
        assertEquals("""{"transcription_language":"ja"}""", gson.toJson(sent[1]))
        assertEquals("""{"transcription_language":"auto"}""", gson.toJson(sent[2]))
        assertEquals("ja", toggled.transcriptionLanguage)
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
        assertTrue(repo.joinMeeting("https://zoom.us/j/1", null, null).isSuccess)
        assertTrue(repo.joinMeeting("https://zoom.us/j/1", null, "ja").isSuccess)
        assertEquals(null, sent[0].transcriptionLanguage)
        assertEquals("ja", sent[1].transcriptionLanguage)
    }

    // ----- live-language response handling -----

    @Test fun http409_fixed_isNotSwitchable() {
        val body = """{"error":{"code":"LIVE_LANGUAGE_FIXED","message":"x"}}"""
        assertEquals(LiveLanguageResult.NotSwitchable(LiveLanguageConflict.FIXED), mapLiveLanguageResponse(409, body, "es"))
    }

    @Test fun http409_notLive_isDistinct() {
        val body = """{"error":{"code":"MEETING_NOT_LIVE","message":"x"}}"""
        assertEquals(LiveLanguageResult.NotSwitchable(LiveLanguageConflict.NOT_LIVE), mapLiveLanguageResponse(409, body, "es"))
    }

    @Test fun http409_unknownBody_isTreatedAsFixed() {
        assertEquals(LiveLanguageResult.NotSwitchable(LiveLanguageConflict.FIXED), mapLiveLanguageResponse(409, null, "es"))
        assertEquals(LiveLanguageResult.NotSwitchable(LiveLanguageConflict.FIXED), mapLiveLanguageResponse(409, "<html>", "es"))
    }

    @Test fun success_usesEchoedLanguageElseRequested_andReadsLiveApplied() {
        assertEquals(LiveLanguageResult.Success("fr", true), mapLiveLanguageResponse(200, """{"ok":true,"language":"fr","live_applied":true}""", "es"))
        assertEquals(LiveLanguageResult.Success("es", true), mapLiveLanguageResponse(200, "", "es"))
        assertEquals(LiveLanguageResult.Success("es", true), mapLiveLanguageResponse(204, null, "es"))
        assertEquals(LiveLanguageResult.Success("es", true), mapLiveLanguageResponse(200, "not json", "es"))
        assertEquals(
            LiveLanguageResult.Success("es", false),
            mapLiveLanguageResponse(200, """{"ok":true,"language":"es","live_applied":false,"message":"Saved"}""", "es")
        )
    }

    @Test fun otherErrorsFail() {
        assertTrue(mapLiveLanguageResponse(400, """{"error":{"code":"BAD_REQUEST"}}""", "es") is LiveLanguageResult.Failed)
        assertTrue(mapLiveLanguageResponse(500, null, "es") is LiveLanguageResult.Failed)
        assertTrue(mapLiveLanguageResponse(404, null, "es") is LiveLanguageResult.Failed)
    }

    @Test fun repository_409_isNotAnException_andReadsTheErrorBody() = runBlocking {
        val api = fakeApi { _, _ ->
            Response.error<ResponseBody>(409, """{"error":{"code":"MEETING_NOT_LIVE","message":"n"}}""".toResponseBody(json))
        }
        assertEquals(
            LiveLanguageResult.NotSwitchable(LiveLanguageConflict.NOT_LIVE),
            MeetingsRepository(api).setLiveLanguage("m1", "es")
        )
    }

    @Test fun repository_postsNormalizedLanguage_andReturnsSuccess() = runBlocking {
        var posted: LiveLanguageRequest? = null
        val api = fakeApi { _, args ->
            posted = args[1] as LiveLanguageRequest
            Response.success("""{"language":"es"}""".toResponseBody(json))
        }
        val result = MeetingsRepository(api).setLiveLanguage("m1", "es-MX")
        assertEquals("es", posted?.language)
        assertEquals(LiveLanguageResult.Success("es", true), result)
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
