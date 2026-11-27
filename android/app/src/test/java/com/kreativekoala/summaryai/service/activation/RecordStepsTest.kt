package com.kreativekoala.summaryai.service.activation

import com.google.gson.JsonParser
import com.kreativekoala.summaryai.testutil.FakeSharedPreferences
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordStepsTest {
    private val sent = ArrayList<String>()
    private val prefs = FakeSharedPreferences()
    private fun reporter() = RecordStepReporter(prefs, "1.7.15", testDevice = false) { sent += it }

    @After fun reset() = RecordSteps.install(null)

    /** The same rules the server applies (backend/src/services/activationEvents.ts): anything else is dropped. */
    @Test fun aStepIsAcceptedByTheServerRules() {
        RecordSteps.install(reporter())
        RecordSteps.step("held_short", "seconds" to 4, "peak" to 120)

        val json = JsonParser.parseString(sent.single()).asJsonObject
        assertEquals("record_clicked", json["name"].asString)
        assertEquals("android", json["platform"].asString)
        assertTrue(json["anon_id"].asString.matches(Regex("^[a-zA-Z0-9-]{16,64}$")))
        assertTrue(json["app_version"].asString.matches(Regex("^[a-zA-Z0-9._+-]{1,20}$")))
        val props = json["props"].asJsonObject
        assertTrue(props.size() <= 8)
        assertTrue(props.keySet().all { it.matches(Regex("^[a-z][a-z0-9_]{0,31}$")) })
        assertEquals("held_short", props["step"].asString)
        assertEquals(4, props["seconds"].asInt)
        assertEquals(false, props["test"].asBoolean)
    }

    @Test fun onlyNamesTheServerAllowsAreUsed() {
        val server = java.io.File("../../backend/src/services/activationEvents.ts").readText()
        for (name in listOf(RecordStepNames.CLICKED, RecordStepNames.STARTED, RecordStepNames.DONE)) {
            assertTrue(name, server.contains("'$name'"))
        }
    }

    @Test fun theRandomIdStaysTheSameForAnInstall() {
        reporter().send(RecordStepNames.STARTED, emptyMap())
        reporter().send(RecordStepNames.DONE, mapOf("ok" to true))
        val ids = sent.map { JsonParser.parseString(it).asJsonObject["anon_id"].asString }
        assertEquals(ids[0], ids[1])
    }

    @Test fun reportingNeverThrows() {
        RecordSteps.track(RecordStepNames.DONE) // nothing installed
        RecordSteps.install(RecordStepReporter(prefs, "1", false) { error("no network") })
        RecordSteps.track(RecordStepNames.DONE, "ok" to false)
    }
}
