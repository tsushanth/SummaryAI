package com.kreativekoala.summaryai.service.voice

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceFeatureGateTest {

    private class ProbeClient(var behaviour: () -> Unit = {}) : VoiceToolsClient by NoClient {
        var calls = 0
        override suspend fun date(timeZone: String): VoiceDate {
            calls++
            behaviour()
            return VoiceDate("2026-11-05", "thursday", timeZone)
        }
    }

    @Test fun buildFlagOffMeansNoServerCallAtAll() = runTest {
        val c = ProbeClient()
        assertFalse(VoiceFeatureGate(c, buildEnabled = false).isAvailable())
        assertEquals(0, c.calls)
    }

    @Test fun serverOffMeansOff() = runTest {
        val c = ProbeClient { throw VoiceUnavailable() }
        assertFalse(VoiceFeatureGate(c, buildEnabled = true).isAvailable())
    }

    @Test fun networkTroubleMeansOffNotCrash() = runTest {
        val c = ProbeClient { throw java.io.IOException("offline") }
        assertFalse(VoiceFeatureGate(c, buildEnabled = true).isAvailable())
    }

    @Test fun onWhenBothAllowAndAnswerIsCached() = runTest {
        val c = ProbeClient()
        var now = 1_000L
        val gate = VoiceFeatureGate(c, buildEnabled = true).also { it.clock = { now } }
        assertTrue(gate.isAvailable())
        assertTrue(gate.isAvailable())
        assertEquals(1, c.calls)
        now += VoiceFeatureGate.TTL_MS + 1
        assertTrue(gate.isAvailable())
        assertEquals(2, c.calls)
    }
}

/** A client that fails every call; tests override only what they use. */
internal object NoClient : VoiceToolsClient {
    override suspend fun date(timeZone: String): VoiceDate = error("unexpected call")
    override suspend fun listActions(status: String, assignee: String?, limit: Int): List<VoiceAction> = error("unexpected call")
    override suspend fun draftAction(request: ActionDraftRequest): ActionDraft = error("unexpected call")
    override suspend fun commitAction(draftId: String): CommittedAction = error("unexpected call")
    override suspend fun debrief(recordingId: String, timeZone: String): Debrief = error("unexpected call")
}
