package com.kreativekoala.summaryai.ui.coaching

import com.kreativekoala.summaryai.data.api.coaching.*
import com.kreativekoala.summaryai.data.repository.CoachingRepository
import com.kreativekoala.summaryai.util.OutputLanguageSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.asResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Pipe
import okio.buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException
import java.util.concurrent.ConcurrentLinkedQueue

class ActiveCoachingSessionTest {

    /** A live tips stream the test writes into. */
    private class LiveStream {
        private val pipe = Pipe(64 * 1024)
        private val sink = pipe.sink.buffer()
        val body: ResponseBody = pipe.source.buffer().asResponseBody("text/event-stream".toMediaType())
        fun send(event: String, data: String) { sink.writeUtf8("event: $event\ndata: $data\n\n").flush() }
        fun tip(id: String, at: Int) = send("insight", """{"id":"$id","session_id":"s1","type":"question","text":"tip $id","urgency":"now","emitted_at":"2026-01-01T00:00:0$at"}""")
        fun drop() = sink.close()
    }

    private class FakeApi : CoachingApi {
        val starts = ConcurrentLinkedQueue<Any>()    // CoachingStartSessionResponse or Exception, in order
        val streams = ConcurrentLinkedQueue<Any>()   // LiveStream or Exception, in order
        @Volatile var latest = CoachingLatestSessionResponse(null, emptyList())
        @Volatile var startCalls = 0
        @Volatile var streamCalls = 0
        val ended = ConcurrentLinkedQueue<String>()

        override suspend fun claimFreeCredits() = throw UnsupportedOperationException()
        override suspend fun getCredits() = throw UnsupportedOperationException()
        override suspend fun startSession(body: CoachingStartSessionRequest): CoachingStartSessionResponse {
            startCalls++
            return when (val next = starts.poll() ?: CoachingStartSessionResponse("s1", "sales_discovery")) {
                is Exception -> throw next
                else -> next as CoachingStartSessionResponse
            }
        }
        override suspend fun endSession(sessionId: String): CoachingEndResponse {
            ended.add(sessionId)
            return CoachingEndResponse(ended = true, refunded = true)
        }
        override suspend fun getInsights(sessionId: String) = throw UnsupportedOperationException()
        override suspend fun getLatestSession(recordingId: String) = latest
        override suspend fun streamInsights(url: String): ResponseBody {
            streamCalls++
            return when (val next = streams.poll() ?: throw IOException("offline")) {
                is Exception -> throw next
                else -> (next as LiveStream).body
            }
        }
        override suspend fun verifyGooglePlayPurchase(body: CoachingGooglePlayVerifyRequest) = throw UnsupportedOperationException()
    }

    private val api = FakeApi()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val coach = ActiveCoachingSession(CoachingRepository(api, OutputLanguageSource { null }), scope)

    @After fun tearDown() = scope.cancel()

    private fun await(what: (CoachingState) -> Boolean): CoachingState =
        runBlocking { withTimeout(15_000) { coach.state.first(what) } }

    private fun refusal(code: Int, body: String = "{}") =
        HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))

    private fun start() = coach.start("meet-1", "rec-1", CoachingPersonaKey.SalesDiscovery)
    private fun tip(id: String) = CoachingInsight(id, "s1", "question", "tip $id", "now", null, "2026-01-01T00:00:0${id.last()}")

    @Test fun tipsArriveOnceNewestFirstAndTheServerEndsTheSession() {
        val stream = LiveStream().also { api.streams.add(it) }
        start()
        await { it.phase == CoachingPhase.LIVE }
        stream.tip("t1", 1); stream.tip("t1", 1); stream.tip("t2", 2)
        assertEquals(listOf("t2", "t1"), await { it.insights.size == 2 }.insights.map { it.id })
        stream.send("ended", """{"reason":"bot_not_admitted","refunded":true}""")
        stream.drop()
        val end = await { it.phase == CoachingPhase.ENDED }
        assertEquals("bot_not_admitted", end.endReason)
        assertTrue(end.refunded)
        assertEquals(2, end.insights.size)
        assertEquals("nothing but the server or the user ends a session", 0, api.ended.size)
    }

    @Test fun aMeetingThatIsAlreadyOverIsSaidSoAndNotRetried() {
        api.starts.add(refusal(409, """{"error":"meeting_not_live","end_reason":"bot_failed"}"""))
        start()
        val s = await { it.phase == CoachingPhase.NOT_STARTED }
        assertEquals(CoachingStartFailure.MEETING_OVER, s.startFailure)
        assertEquals("bot_failed", s.endReason)
        assertEquals(1, api.startCalls)
    }

    @Test fun noCreditsIsSaidSo() {
        api.starts.add(refusal(402))
        start()
        assertEquals(CoachingStartFailure.NO_CREDITS, await { it.phase == CoachingPhase.NOT_STARTED }.startFailure)
        assertEquals(1, api.startCalls)
    }

    @Test fun aStartLostOnTheNetworkIsRepeated() {
        api.starts.add(IOException("reset"))
        api.streams.add(LiveStream())
        start()
        await { it.phase == CoachingPhase.LIVE }
        assertEquals(2, api.startCalls)
    }

    @Test fun otherFailuresCanBeRetriedByTheUser() {
        api.starts.add(refusal(400))
        start()
        assertEquals(CoachingStartFailure.OTHER, await { it.phase == CoachingPhase.NOT_STARTED }.startFailure)
        api.streams.add(LiveStream())
        coach.retry()
        await { it.phase == CoachingPhase.LIVE }
    }

    @Test fun aDroppedConnectionIsReopenedAndMissedTipsAreFetched() {
        val first = LiveStream().also { api.streams.add(it) }
        val second = LiveStream().also { api.streams.add(it) }
        start()
        await { it.phase == CoachingPhase.LIVE }
        first.tip("t1", 1)
        await { it.insights.size == 1 }
        api.latest = CoachingLatestSessionResponse(CoachingLatestSession("s1", null, false, null), listOf(tip("t1"), tip("t2")))
        first.drop()
        assertEquals(listOf("t2", "t1"), await { it.insights.size == 2 }.insights.map { it.id })
        await { it.phase == CoachingPhase.LIVE && api.streamCalls == 2 }
        second.tip("t2", 2); second.tip("t3", 3)
        assertEquals(listOf("t3", "t2", "t1"), await { it.insights.size == 3 }.insights.map { it.id })
        assertEquals(0, api.ended.size)
    }

    @Test fun aSessionThatEndedWhileDisconnectedStopsReconnecting() {
        val stream = LiveStream().also { api.streams.add(it) }
        start()
        await { it.phase == CoachingPhase.LIVE }
        api.latest = CoachingLatestSessionResponse(CoachingLatestSession("s1", "2026-01-01T00:10:00", true, "no_speech"), emptyList())
        stream.drop()
        val end = await { it.phase == CoachingPhase.ENDED }
        assertEquals("no_speech", end.endReason)
        assertTrue(end.refunded)
        runBlocking { delay(2_500) }
        assertEquals(1, api.streamCalls)
    }

    @Test fun reopeningAnEarlierMeetingShowsItsTips() {
        api.latest = CoachingLatestSessionResponse(CoachingLatestSession("s0", "2026-01-01T00:10:00", false, null), listOf(tip("t1")))
        coach.attach("meet-1", "rec-1")
        val s = await { it.phase == CoachingPhase.ENDED }
        assertEquals(1, s.insights.size)
        assertEquals(0, api.streamCalls)
    }

    @Test fun lookingAtAnEarlierMeetingLeavesTheRunningSessionAlone() {
        api.streams.add(LiveStream())
        start()
        await { it.phase == CoachingPhase.LIVE }
        api.latest = CoachingLatestSessionResponse(CoachingLatestSession("s0", "2026-01-01T00:10:00", false, null), emptyList())
        coach.attach("meet-0", "rec-0")
        runBlocking { delay(300) }
        assertEquals("meet-1", coach.state.value.meetingId)
        assertEquals(CoachingPhase.LIVE, coach.state.value.phase)
    }

    @Test fun aRestartedAppPicksUpTheOpenSession() {
        api.latest = CoachingLatestSessionResponse(CoachingLatestSession("s1", null, false, null), emptyList())
        api.streams.add(LiveStream())
        coach.attach("meet-1", "rec-1")
        await { it.phase == CoachingPhase.LIVE }
        assertEquals(0, api.startCalls)
    }

    @Test fun aMeetingWithoutASessionShowsNothing() {
        coach.attach("meet-1", "rec-1")
        runBlocking { delay(300) }
        assertEquals(CoachingPhase.IDLE, coach.state.value.phase)
        assertNull(coach.state.value.meetingId)
    }

    @Test fun onlyTheUsersStopEndsTheSession() {
        api.streams.add(LiveStream())
        start()
        await { it.phase == CoachingPhase.LIVE }
        coach.stop()
        val s = await { it.phase == CoachingPhase.ENDED && it.refunded }
        assertEquals(ActiveCoachingSession.REASON_STOPPED, s.endReason)
        assertEquals(listOf("s1"), api.ended.toList())
    }
}
