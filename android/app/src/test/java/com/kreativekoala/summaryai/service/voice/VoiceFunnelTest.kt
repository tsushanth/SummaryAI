package com.kreativekoala.summaryai.service.voice

import com.kreativekoala.summaryai.service.activation.ActivationSink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private class Sink : ActivationSink {
    val events = mutableListOf<Pair<String, Map<String, Any>>>()
    var throwOnLog = false
    override fun log(name: String, params: Map<String, Any>) {
        if (throwOnLog) error("analytics down")
        events += name to params
    }
    override fun setUserProperty(name: String, value: String) = Unit
}

class VoiceFunnelTest {
    private val sink = Sink()
    private val funnel = VoiceFunnel(sink)

    @Test fun everyEventNameIsVoicePrefixedAndFitsFirebase() {
        for (n in VoiceEvents.ALL) {
            assertTrue(n, n.startsWith("voice_"))
            assertTrue("$n too long for Firebase (40)", n.length <= 40)
            assertTrue(n, Regex("^[a-z0-9_]+$").matches(n))
        }
    }

    @Test fun unknownEventsAreIgnored() {
        funnel.log("voice_made_up")
        funnel.log("act_first_open")
        assertTrue(sink.events.isEmpty())
    }

    @Test fun onlyNumbersBooleansAndShortTokensGetThrough() {
        funnel.log(
            VoiceEvents.HEARD,
            mapOf(
                "recognizer" to "on_device",
                "char_count" to 31,
                "duration_ms" to 1800L,
                "ok" to true,
                "transcript" to "send the deck to Dan by Friday", // free text: dropped
                "email" to "dan@example.com",                      // dropped
                "Name With Spaces" to "x",                          // bad key: dropped
                "nested" to listOf("a"),                             // not a scalar: dropped
                "nothing" to null,
                "long_token" to "a".repeat(41),                      // too long: dropped
            )
        )
        assertEquals(
            mapOf<String, Any>("recognizer" to "on_device", "char_count" to 31, "duration_ms" to 1800L, "ok" to true),
            sink.events.single().second
        )
    }

    @Test fun typedHelpersCarryCountsNotText() {
        funnel.heard("network", 12, 900)
        funnel.actionDrafted(hasDue = true, hasOwner = false)
        funnel.actionConfirmed(edited = false)
        funnel.actionConfirmed(edited = true)
        funnel.debriefFinished(listenedPercent = 250, decisions = 3, actions = 2)
        funnel.outwardPrepared("email_draft")
        assertEquals(
            listOf(
                VoiceEvents.HEARD, VoiceEvents.ACTION_DRAFTED, VoiceEvents.ACTION_CONFIRMED,
                VoiceEvents.ACTION_EDITED, VoiceEvents.DEBRIEF_FINISHED, VoiceEvents.OUTWARD_PREPARED,
            ),
            sink.events.map { it.first }
        )
        assertEquals(100, sink.events[4].second["listened_pct"]) // clamped
        assertEquals(mapOf<String, Any>("has_due" to true, "has_owner" to false), sink.events[1].second)
        assertEquals(emptyMap<String, Any>(), sink.events[2].second)
    }

    @Test fun aFailingSinkNeverThrowsIntoTheScreen() {
        sink.throwOnLog = true
        funnel.entryShown("todos")
        funnel.entryTapped("todos")
    }
}
