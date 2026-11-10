package com.kreativekoala.summaryai.service.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceIntentParserTest {

    private fun add(text: String) = VoiceIntentParser.parse(text) as VoiceIntent.AddAction

    @Test fun addWithDueAndDefaultOwner() {
        val a = add("add an action item for me to send the deck to Dan by Friday")
        assertEquals("Send the deck to Dan", a.title)
        assertEquals("Friday", a.dueText)
        assertEquals(null, a.assignee)
    }

    @Test fun addForSomeoneElse() {
        val a = add("Add an action item for Priya to confirm the QA budget")
        assertEquals("Confirm the QA budget", a.title)
        assertEquals("Priya", a.assignee)
        assertEquals(null, a.dueText)
    }

    @Test fun remindMeVariantsAndBareDueWord() {
        val a = add("remind me to renew the domain tomorrow")
        assertEquals("Renew the domain", a.title)
        assertEquals("tomorrow", a.dueText)
        assertEquals("Call the vendor", add("create a task to call the vendor").title)
    }

    @Test fun byInsideTitleIsNotADueDate() {
        val a = add("add an action item to review the report by Dan")
        assertEquals("Review the report by Dan", a.title)
        assertEquals(null, a.dueText)
    }

    @Test fun isoAndMonthDayDues() {
        assertEquals("2026-11-06", add("add a task to ship the build due 2026-11-06").dueText)
        assertEquals("November 6th", add("add a task to ship the build by November 6th").dueText)
        assertEquals("next week", add("add a todo to book the review by next week").dueText)
    }

    @Test fun addWithNothingToAddIsUnknown() {
        assertEquals(VoiceIntent.Unknown, VoiceIntentParser.parse("add an action item"))
        assertEquals(VoiceIntent.Unknown, VoiceIntentParser.parse(""))
        assertEquals(VoiceIntent.Unknown, VoiceIntentParser.parse("what a lovely day"))
    }

    @Test fun listOpen() {
        for (t in listOf("what are my open actions", "What's on my list", "read my action items", "list my open tasks", "what do I have")) {
            assertEquals(t, VoiceIntent.ListOpen, VoiceIntentParser.parse(t))
        }
    }

    @Test fun markDone() {
        assertEquals(VoiceIntent.MarkDone("budget"), VoiceIntentParser.parse("mark the budget item done"))
        assertEquals(VoiceIntent.MarkDone("review Q4 budget"), VoiceIntentParser.parse("Mark review Q4 budget as complete"))
        assertEquals(VoiceIntent.MarkDone("deck for Priya"), VoiceIntentParser.parse("I finished the deck for Priya"))
        assertEquals(VoiceIntent.MarkDone("domain renewal"), VoiceIntentParser.parse("check off domain renewal"))
    }

    @Test fun debriefUndoStop() {
        assertEquals(VoiceIntent.Debrief, VoiceIntentParser.parse("give me the debrief"))
        assertEquals(VoiceIntent.Debrief, VoiceIntentParser.parse("highlights"))
        assertEquals(VoiceIntent.Undo, VoiceIntentParser.parse("undo that"))
        assertEquals(VoiceIntent.Stop, VoiceIntentParser.parse("never mind"))
    }

    // ---- replies ----

    @Test fun plainYesOnly() {
        for (t in listOf("yes", "Yes.", "yeah", "save it", "Yes, save it!", "go ahead", "okay")) {
            assertEquals(t, VoiceReplyIntent.Yes, VoiceIntentParser.parseReply(t))
        }
    }

    @Test fun yesWithExtrasIsNotAYes() {
        val r = VoiceIntentParser.parseReply("yes but make it Monday")
        assertTrue(r is VoiceReplyIntent.Other)
        assertTrue(VoiceIntentParser.parseReply("yes and also send it to Dan") is VoiceReplyIntent.Other)
        assertTrue(VoiceIntentParser.parseReply("save the pricing deck for Dan") is VoiceReplyIntent.Other)
    }

    @Test fun noEditUndoAndPicks() {
        assertEquals(VoiceReplyIntent.No, VoiceIntentParser.parseReply("no"))
        assertEquals(VoiceReplyIntent.No, VoiceIntentParser.parseReply("cancel that"))
        assertEquals(VoiceReplyIntent.Edit, VoiceIntentParser.parseReply("edit"))
        assertEquals(VoiceReplyIntent.Undo, VoiceIntentParser.parseReply("undo"))
        assertEquals(VoiceReplyIntent.Pick(1), VoiceIntentParser.parseReply("the first one"))
        assertEquals(VoiceReplyIntent.Pick(1), VoiceIntentParser.parseReply("Save the first one only"))
        assertEquals(VoiceReplyIntent.Pick(2), VoiceIntentParser.parseReply("number two"))
        assertEquals(VoiceReplyIntent.PickMany(listOf(1, 3)), VoiceIntentParser.parseReply("the first and the third"))
        assertEquals(VoiceReplyIntent.All, VoiceIntentParser.parseReply("save them"))
        assertEquals(VoiceReplyIntent.Other(""), VoiceIntentParser.parseReply("   "))
    }
}
