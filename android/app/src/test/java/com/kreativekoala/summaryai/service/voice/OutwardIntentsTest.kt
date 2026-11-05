package com.kreativekoala.summaryai.service.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class OutwardIntentsTest {

    @Test fun emailDraftEncodesAndSendsNothingByItself() {
        val s = OutwardIntents.emailDraft("Action: Send & check deck", "Line one\nDue: Friday")
        assertEquals("email_draft", s.kind)
        assertEquals(OutwardIntents.ACTION_SENDTO, s.action)
        assertEquals("mailto:?subject=Action%3A%20Send%20%26%20check%20deck&body=Line%20one%0ADue%3A%20Friday", s.dataUri)
        assertTrue(s.extras.isEmpty())
    }

    @Test fun calendarHoldIsAllDayOnTheDueDate() {
        val s = OutwardIntents.calendarHold("Send the deck", "2026-11-06", "Owner: Priya")!!
        assertEquals("calendar_hold", s.kind)
        assertEquals(OutwardIntents.ACTION_INSERT, s.action)
        assertEquals(OutwardIntents.CALENDAR_EVENTS_URI, s.dataUri)
        assertEquals(true, s.extras["allDay"])
        assertEquals(86_400_000L, (s.extras["endTime"] as Long) - (s.extras["beginTime"] as Long))
        assertEquals("Owner: Priya", s.extras["description"])
    }

    @Test fun calendarHoldNeedsARealDate() {
        assertNull(OutwardIntents.calendarHold("x", "friday"))
        assertFalse(OutwardIntents.calendarHold("x", "2026-11-06")!!.extras.containsKey("description"))
    }

    @Test fun emailForActionUsesOnlyWhatIsOnTheConfirmSheet() {
        val d = ActionDraft("secret-draft-token", "Send the deck.", "Priya", "2026-11-06", "high", "rec-123", "key")
        val s = OutwardIntents.emailForAction(d, LocalDate.of(2026, 11, 5))
        val uri = s.dataUri!!
        assertTrue(uri.contains("Send%20the%20deck"))
        assertTrue(uri.contains("Owner%3A%20Priya"))
        assertTrue(uri.contains("Due%3A%20tomorrow"))
        assertFalse(uri.contains("secret"))
        assertFalse(uri.contains("rec-123"))
    }
}
