package com.kreativekoala.summaryai.service.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ActionMatcherTest {
    private fun a(id: String, title: String, kind: String = "todo", done: Boolean = false) =
        VoiceAction(id, kind, title, null, null, done, null, null, null)

    private val list = listOf(
        a("1", "Review Q4 budget"),
        a("2", "Budget deck for Priya"),
        a("3", "Renew the domain"),
        a("4", "Send the deck to Dan", done = true),
        a("5", "Book the review", kind = "summary_item"),
    )

    @Test fun oneClearMatch() {
        assertEquals(ActionMatcher.Match.One(list[2]), ActionMatcher.match("domain", list))
    }

    @Test fun twoMatchesAsksWhich() {
        val m = ActionMatcher.match("budget", list)
        assertTrue(m is ActionMatcher.Match.Many)
        assertEquals(listOf("1", "2"), (m as ActionMatcher.Match.Many).actions.map { it.id })
    }

    @Test fun exactTitleWinsOverPartials() {
        assertEquals(ActionMatcher.Match.One(list[0]), ActionMatcher.match("review q4 budget", list))
    }

    @Test fun doneAndSummaryOnlyItemsAreNeverCandidates() {
        assertEquals(ActionMatcher.Match.None, ActionMatcher.match("send deck dan", list))
        assertEquals(ActionMatcher.Match.None, ActionMatcher.match("book review", list))
    }

    @Test fun shortFragmentsDoNotMatchByPrefix() {
        assertEquals(ActionMatcher.Match.None, ActionMatcher.match("bud", list))
        assertEquals(ActionMatcher.Match.None, ActionMatcher.match("", list))
    }

    @Test fun neverMoreThanThreeChoices() {
        val many = (1..6).map { a("$it", "Budget item $it") }
        assertEquals(3, (ActionMatcher.match("budget", many) as ActionMatcher.Match.Many).actions.size)
    }
}
