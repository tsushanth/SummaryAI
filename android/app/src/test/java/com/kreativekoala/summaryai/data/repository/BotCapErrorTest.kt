package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import java.util.Locale

class BotCapErrorTest {
    private val json = "application/json".toMediaType()
    private val capBody = """{"error":{"code":"BOT_MONTHLY_CAP_REACHED","message":"m","details":{"cap_minutes":"10","used_minutes":"11","remaining_minutes":"0","resets_at":"2026-12-01T00:00:00.000Z"}}}"""

    // ----- parsing -----

    @Test fun capResponse_isRecognised_andCarriesTheResetTime() {
        val e = parseBotCapError(403, capBody)
        assertNotNull(e)
        assertEquals("2026-12-01T00:00:00.000Z", e!!.resetsAt)
    }

    @Test fun capResponse_withoutDetails_isStillRecognised() {
        val e = parseBotCapError(403, """{"error":{"code":"BOT_MONTHLY_CAP_REACHED","message":"m"}}""")
        assertNotNull(e)
        assertNull(e!!.resetsAt)
    }

    @Test fun otherErrors_areNotTreatedAsTheCap() {
        assertNull(parseBotCapError(403, """{"error":{"code":"FORBIDDEN","message":"x"}}"""))
        assertNull(parseBotCapError(422, """{"error":{"code":"UNPROCESSABLE_ENTITY","message":"x"}}"""))
        assertNull(parseBotCapError(500, capBody)) // the code only counts on a 403
    }

    @Test fun unreadableBodies_areNotTreatedAsTheCap() {
        assertNull(parseBotCapError(403, null))
        assertNull(parseBotCapError(403, ""))
        assertNull(parseBotCapError(403, "<html>Forbidden</html>"))
        assertNull(parseBotCapError(403, """["BOT_MONTHLY_CAP_REACHED"]"""))
        assertNull(parseBotCapError(403, """{"error":"BOT_MONTHLY_CAP_REACHED"}"""))
    }

    // ----- message building -----

    @Test fun resetDate_isFormattedForTheLocale_inUtc() {
        assertEquals("December 1, 2026", formatBotCapResetDate("2026-12-01T00:00:00.000Z", Locale.US))
        assertEquals("1. Dezember 2026", formatBotCapResetDate("2026-12-01T00:00:00.000Z", Locale.GERMANY))
    }

    @Test fun resetDate_missingOrInvalid_isNull() {
        assertNull(formatBotCapResetDate(null, Locale.US))
        assertNull(formatBotCapResetDate("", Locale.US))
        assertNull(formatBotCapResetDate("next month", Locale.US))
    }

    @Test fun message_usesTheDateWhenKnown_andTheFallbackOtherwise() {
        val with = { d: String -> "resets on $d" }
        val without = { "resets next month" }
        assertEquals("resets on December 1, 2026", buildBotCapMessage("2026-12-01T00:00:00.000Z", Locale.US, with, without))
        assertEquals("resets next month", buildBotCapMessage(null, Locale.US, with, without))
        assertEquals("resets next month", buildBotCapMessage("garbage", Locale.US, with, without))
    }

    // ----- repository -----

    @Test fun joinMeeting_403Cap_failsWithTheCapException() = runBlocking {
        val api = fakeApi { _, _ -> throw HttpException(Response.error<ResponseBody>(403, capBody.toResponseBody(json))) }
        val error = MeetingsRepository(api).joinMeeting("https://zoom.us/j/1").exceptionOrNull()
        assertTrue(error is BotCapReachedException)
        assertEquals("2026-12-01T00:00:00.000Z", (error as BotCapReachedException).resetsAt)
    }

    @Test fun joinMeeting_otherHttpErrors_keepTheOriginalException() = runBlocking {
        val api = fakeApi { _, _ -> throw HttpException(Response.error<ResponseBody>(500, """{"error":{"code":"INTERNAL_ERROR"}}""".toResponseBody(json))) }
        val error = MeetingsRepository(api).joinMeeting("https://zoom.us/j/1").exceptionOrNull()
        assertTrue(error is HttpException)
        assertEquals(500, (error as HttpException).code())
    }

    @Test fun joinMeeting_nonHttpErrors_keepTheOriginalException() = runBlocking {
        val api = fakeApi { _, _ -> throw IllegalStateException("offline") }
        val error = MeetingsRepository(api).joinMeeting("https://zoom.us/j/1").exceptionOrNull()
        assertTrue(error is IllegalStateException)
    }

    // ----- fake api (the interface is large; only the methods under test are answered) -----

    private fun fakeApi(handler: (method: String, args: List<Any?>) -> Any?): SummaryAIApi {
        val loader = SummaryAIApi::class.java.classLoader
        return Proxy.newProxyInstance(loader, arrayOf(SummaryAIApi::class.java)) { _, method, args ->
            val real = (args ?: emptyArray()).dropLast(1)
            try {
                handler(method.name, real)
            } catch (e: InvocationTargetException) {
                throw e.targetException
            }
        } as SummaryAIApi
    }
}
