package com.kreativekoala.summaryai.service.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class SpokenTextTest {
    private val today = LocalDate.of(2026, 11, 5) // a Thursday

    private fun act(title: String, due: String? = null) = VoiceAction("i", "todo", title, null, due, false, null, null, null)

    @Test fun dayWording() {
        assertEquals("today", SpokenText.day("2026-11-05", today))
        assertEquals("tomorrow", SpokenText.day("2026-11-06", today))
        assertEquals("Monday", SpokenText.day("2026-11-09", today))
        assertEquals("Friday, November 13", SpokenText.day("2026-11-13", today))
        assertEquals(null, SpokenText.day(null, today))
        assertEquals(null, SpokenText.day("soon", today))
    }

    @Test fun readbackNamesEveryFieldThatWillBeSaved() {
        val d = ActionDraft("x", "Send the deck to Dan", "Priya", "2026-11-06", "none", null, null)
        assertEquals("Task: Send the deck to Dan. Owner: Priya. Due tomorrow. Save it?", SpokenText.readback(d, today))
        val bare = ActionDraft("x", "Renew domain.", null, null, "none", null, null)
        assertEquals("Task: Renew domain. Save it?", SpokenText.readback(bare, today))
    }

    @Test fun openActionsReadsAtMostThreeAndSaysOverdue() {
        val s = SpokenText.openActions(
            listOf(
                act("Renew the domain", "2026-11-02"),
                act("Send the deck", "2026-11-06"),
                act("Book review", "2026-11-09"),
                act("Fourth dated", "2026-11-20"),
                act("No date one"),
                act("No date two"),
            ),
            today,
        )
        assertTrue(s, s.startsWith("You have six open actions."))
        assertTrue(s, "Overdue: Renew the domain." in s)
        assertTrue(s, "Due tomorrow: Send the deck." in s)
        assertFalse(s, "Fourth dated" in s)
        assertTrue(s, "Two with no date." in s)
        assertTrue(s, s.endsWith("Want the rest?"))
    }

    @Test fun emptyAndUndatedLists() {
        assertEquals("You have no open actions.", SpokenText.openActions(emptyList(), today))
        val s = SpokenText.openActions(listOf(act("A"), act("B")), today)
        assertEquals("You have two open actions. A; B.", s)
    }

    @Test fun debriefIsShortAndOffersToSave() {
        val d = Debrief(
            "r", "Standup",
            decisions = listOf(DebriefItem("Ship Friday", null, null, null), DebriefItem("Keep the free tier", null, null, null)),
            actions = listOf(DebriefItem("Send the deck to Dan", "me", "2026-11-06", "k1")),
            truncated = false, note = null,
        )
        val s = SpokenText.debrief(d, today)
        assertEquals("Two decisions: Ship Friday; Keep the free tier. One action: Send the deck to Dan, for me, due tomorrow. Say save them to add them to your list.", s)
    }

    @Test fun debriefWithNothingUsesTheServerNote() {
        val d = Debrief("r", null, emptyList(), emptyList(), false, "Too little was said to debrief.")
        assertEquals("Too little was said to debrief.", SpokenText.debrief(d, today))
    }
}
