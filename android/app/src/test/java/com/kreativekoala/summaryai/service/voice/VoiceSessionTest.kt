package com.kreativekoala.summaryai.service.voice

import com.kreativekoala.summaryai.service.activation.ActivationSink
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

private class RecordingSink : ActivationSink {
    val events = mutableListOf<Pair<String, Map<String, Any>>>()
    override fun log(name: String, params: Map<String, Any>) { events += name to params }
    override fun setUserProperty(name: String, value: String) = Unit
}

private class FakeClient : VoiceToolsClient {
    var open: List<VoiceAction> = emptyList()
    var debrief: Debrief = Debrief("rec-1", "Standup", emptyList(), emptyList(), false, null)
    var failWith: Exception? = null
    var dueFailures = 0
    val drafts = mutableListOf<ActionDraftRequest>()
    val commits = mutableListOf<String>()
    var commitFailsExpired = false
    private var n = 0

    override suspend fun date(timeZone: String) = VoiceDate("2026-11-05", "thursday", timeZone)
    override suspend fun listActions(status: String, assignee: String?, limit: Int): List<VoiceAction> {
        failWith?.let { throw it }
        return open
    }
    override suspend fun draftAction(request: ActionDraftRequest): ActionDraft {
        failWith?.let { throw it }
        if (request.dueText != null && dueFailures > 0) { dueFailures--; throw DueNotUnderstood() }
        drafts += request
        n++
        val due = when (request.dueText?.lowercase()) { null -> null; "friday" -> "2026-11-06"; else -> request.dueText }
        return ActionDraft("draft-$n", request.title, request.assignee, due, "none", request.recordingId, request.summaryItemKey)
    }
    override suspend fun commitAction(draftId: String): CommittedAction {
        if (commitFailsExpired) throw DraftExpired()
        commits += draftId
        return CommittedAction("todo-$draftId", true)
    }
    override suspend fun debrief(recordingId: String, timeZone: String): Debrief {
        failWith?.let { throw it }
        return debrief
    }
}

private class FakeTodos : TodoMutations {
    val completed = mutableMapOf<String, Boolean>()
    val deleted = mutableListOf<String>()
    var ok = true
    override suspend fun setCompleted(id: String, completed: Boolean): Boolean { if (ok) this.completed[id] = completed; return ok }
    override suspend fun delete(id: String): Boolean { if (ok) deleted += id; return ok }
}

class VoiceSessionTest {
    private val client = FakeClient()
    private val todos = FakeTodos()
    private val sink = RecordingSink()
    private var now = 1_000_000L
    private var loud = false
    private val session = VoiceSession(
        client, todos, VoiceFunnel(sink),
        clock = { now }, today = { LocalDate.of(2026, 11, 5) }, timeZone = { "America/Los_Angeles" }, loudspeaker = { loud },
    )

    private fun todo(id: String, title: String, due: String? = null) = VoiceAction(id, "todo", title, null, due, false, null, null, null)

    // ---- Tier 1: nothing is saved without a clear yes ----

    @Test fun addReadsBackAndSavesOnlyAfterYes() = runTest {
        val r = session.onHeard("add an action item for me to send the deck to Dan by Friday")
        assertEquals("Task: Send the deck to Dan. Due tomorrow. Save it?", r.speech)
        assertTrue(r.listen)
        assertTrue(client.commits.isEmpty())
        assertEquals("Friday", client.drafts.single().dueText)

        val saved = session.onHeard("yes")
        assertEquals(listOf("draft-1"), client.commits)
        assertTrue(saved.speech.startsWith("Saved."))
        assertTrue(saved.state is VoiceState.Undoable)
    }

    @Test fun silenceNoAndUnclearAnswersAllCancel() = runTest {
        session.onHeard("add a task to call the vendor")
        assertEquals("No answer, so nothing was saved.", session.onSilence().speech)
        assertTrue(client.commits.isEmpty())

        session.onHeard("add a task to call the vendor")
        assertTrue(session.onHeard("no").speech.startsWith("Cancelled"))

        session.onHeard("add a task to call the vendor")
        val first = session.onHeard("hmm maybe")
        assertTrue(first.listen)
        val second = session.onHeard("yes but call them on Monday")
        assertEquals("I did not hear a yes, so nothing was saved.", second.speech)
        assertTrue(client.commits.isEmpty())
        assertEquals(VoiceState.Idle, session.state)
    }

    @Test fun editHandsTheDraftToTheDialogAndSavesNothing() = runTest {
        session.onHeard("add a task to call the vendor")
        val r = session.onHeard("edit")
        assertNotNull(r.openEditor)
        assertEquals("Call the vendor", r.openEditor!!.title)
        assertTrue(client.commits.isEmpty())
        assertEquals(VoiceState.Idle, session.state)
    }

    @Test fun unreadableDueAsksOnceThenGivesUp() = runTest {
        client.dueFailures = 2
        val ask = session.onHeard("add a task to ship the build by Friday")
        assertEquals("What date should I use?", ask.speech)
        val giveUp = session.onHeard("whenever")
        assertEquals("I could not read that date, so nothing was saved.", giveUp.speech)
        assertTrue(client.drafts.isEmpty())
    }

    @Test fun unreadableDueThenGoodDateWorks() = runTest {
        client.dueFailures = 1
        session.onHeard("add a task to ship the build by Friday")
        val r = session.onHeard("Friday")
        assertTrue(r.speech.contains("Due tomorrow"))
        assertTrue(session.state is VoiceState.ConfirmingAction)
    }

    @Test fun expiredDraftSavesNothing() = runTest {
        session.onHeard("add a task to call the vendor")
        client.commitFailsExpired = true
        val r = session.onHeard("yes")
        assertTrue(r.speech.startsWith("That draft expired"))
        assertTrue(client.commits.isEmpty())
    }

    // ---- undo window ----

    @Test fun undoWithinTenSecondsRemovesTheNewItem() = runTest {
        session.onHeard("add a task to call the vendor")
        session.onHeard("yes")
        now += 9_000
        assertEquals("Undone.", session.onHeard("undo").speech)
        assertEquals(listOf("todo-draft-1"), todos.deleted)
    }

    @Test fun undoAfterTheWindowIsRefused() = runTest {
        session.onHeard("add a task to call the vendor")
        session.onHeard("yes")
        now += 10_001
        val r = session.onHeard("undo")
        assertTrue(r.speech.startsWith("That is too late"))
        assertTrue(todos.deleted.isEmpty())
    }

    @Test fun anotherCommandAfterSavingIsNotTreatedAsUndo() = runTest {
        session.onHeard("add a task to call the vendor")
        session.onHeard("yes")
        client.open = listOf(todo("a", "Renew the domain"))
        val r = session.onHeard("what are my open actions")
        assertTrue(r.speech.startsWith("You have one open action."))
        assertTrue(todos.deleted.isEmpty())
    }

    // ---- reading and completing ----

    @Test fun listOpenSpeaksTheList() = runTest {
        client.open = listOf(todo("a", "Renew the domain", "2026-11-02"), todo("b", "Send the deck", "2026-11-06"))
        val r = session.onHeard("what are my open actions")
        assertEquals("You have two open actions. Overdue: Renew the domain. Due tomorrow: Send the deck.", r.speech)
        assertFalse(r.listen)
    }

    @Test fun markDoneAsksWhichWhenTwoMatchThenCompletesTheChosenOne() = runTest {
        client.open = listOf(todo("1", "Review Q4 budget"), todo("2", "Budget deck for Priya"), todo("3", "Renew the domain"))
        val ask = session.onHeard("mark the budget item done")
        assertTrue(ask.speech.startsWith("2 match."))
        assertTrue(ask.listen)
        assertTrue(todos.completed.isEmpty())
        val done = session.onHeard("the first one")
        assertEquals(mapOf("1" to true), todos.completed)
        assertTrue(done.speech.startsWith("Marked Review Q4 budget done."))
        // and it can be taken back
        session.onHeard("undo")
        assertEquals(mapOf("1" to false), todos.completed)
    }

    @Test fun markDoneWithNoMatchChangesNothing() = runTest {
        client.open = listOf(todo("3", "Renew the domain"))
        assertEquals("I could not find an open item like that.", session.onHeard("mark the invoice done").speech)
        assertTrue(todos.completed.isEmpty())
    }

    @Test fun unclearPickChangesNothing() = runTest {
        client.open = listOf(todo("1", "Review Q4 budget"), todo("2", "Budget deck for Priya"))
        session.onHeard("mark budget done")
        session.onHeard("umm")
        val r = session.onHeard("hmm")
        assertEquals("I could not tell which one, so I changed nothing.", r.speech)
        assertTrue(todos.completed.isEmpty())
    }

    // ---- debrief ----

    private fun debriefOf(vararg actions: DebriefItem) = Debrief(
        "rec-1", "Standup", listOf(DebriefItem("Ship Friday", null, null, null)), actions.toList(), false, null,
    )

    @Test fun debriefThenSaveJustTheFirstActionGoesThroughReadback() = runTest {
        client.debrief = debriefOf(
            DebriefItem("Send the deck to Dan", null, "2026-11-06", "k1"),
            DebriefItem("Book the review", null, null, "k2"),
        )
        val r = session.startDebrief("rec-1")
        assertTrue(r.speech.contains("Say save them"))
        assertEquals(1 to 2, r.debriefCounts)
        assertTrue(r.listen)
        val draft = session.onHeard("save the first one only")
        assertEquals("OK. Next. Task: Send the deck to Dan. Due tomorrow. Save it?", draft.speech)
        assertEquals("k1", client.drafts.single().summaryItemKey)
        assertEquals("rec-1", client.drafts.single().recordingId)
        assertTrue(client.commits.isEmpty())
        session.onHeard("yes")
        assertEquals(1, client.commits.size)
    }

    @Test fun saveThemAllConfirmsEachOneInTurn() = runTest {
        client.debrief = debriefOf(DebriefItem("Send the deck", null, null, "k1"), DebriefItem("Book the review", null, null, "k2"))
        session.startDebrief("rec-1")
        session.onHeard("save them")
        val second = session.onHeard("yes")
        assertTrue(second.speech.startsWith("Saved. Next. Task: Book the review."))
        session.onHeard("no")
        assertEquals(1, client.commits.size)
        assertEquals(VoiceState.Idle, session.state)
    }

    @Test fun onLoudspeakerTheDebriefAsksBeforeReadingAloud() = runTest {
        loud = true
        client.debrief = debriefOf(DebriefItem("Send the deck", null, null, "k1"))
        val ask = session.startDebrief("rec-1")
        assertTrue(ask.speech.contains("speaker"))
        assertNull(ask.debriefCounts)
        val declined = session.onHeard("no")
        assertTrue(declined.speech.contains("headphones"))
        assertEquals(VoiceState.Idle, session.state)

        session.startDebrief("rec-1")
        val read = session.onHeard("yes")
        assertEquals(1 to 1, read.debriefCounts)
    }

    @Test fun debriefWithoutAMeetingOnScreenSaysSo() = runTest {
        assertEquals("Open a meeting first, then ask for its debrief.", session.onHeard("give me the debrief").speech)
    }

    // ---- failures and privacy ----

    @Test fun serverTroubleIsSpokenPlainlyAndSavesNothing() = runTest {
        client.failWith = java.io.IOException("offline")
        val r = session.onHeard("add a task to call the vendor")
        assertEquals("I could not reach the server. Nothing was saved.", r.speech)
        assertTrue(client.commits.isEmpty())
        assertEquals(VoiceState.Idle, session.state)
    }

    @Test fun featureOffIsSpokenNotCrashed() = runTest {
        client.failWith = VoiceUnavailable()
        assertEquals("Voice actions are not available right now.", session.onHeard("what are my open actions").speech)
    }

    @Test fun unknownSpeechGetsHelp() = runTest {
        val r = session.onHeard("the weather is nice")
        assertTrue(r.speech.startsWith("Sorry, I did not get that."))
    }

    @Test fun funnelNeverSeesWhatWasSaid() = runTest {
        session.onHeard("add an action item for Priya to confirm the secret budget by Friday")
        session.onHeard("yes")
        session.onHeard("undo")
        val all = sink.events.joinToString { it.first + it.second }
        assertFalse(all, all.contains("Priya", ignoreCase = true))
        assertFalse(all, all.contains("budget", ignoreCase = true))
        assertTrue(sink.events.map { it.first }.containsAll(listOf(VoiceEvents.ACTION_DRAFTED, VoiceEvents.ACTION_CONFIRMED, VoiceEvents.ACTION_UNDONE)))
        assertEquals(mapOf<String, Any>("has_due" to true, "has_owner" to true), sink.events.first { it.first == VoiceEvents.ACTION_DRAFTED }.second)
    }
}
