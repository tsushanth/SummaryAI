package com.kreativekoala.summaryai.ui.calendar

import com.kreativekoala.summaryai.R
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CalendarReturnTest {

    @Test fun `reads the links the server redirects to`() {
        assertEquals(
            CalendarReturn.Connected("google"),
            CalendarReturn.parse("summaryai://calendar/connected?provider=google&email=a%40example.com")
        )
        assertEquals(
            CalendarReturn.Failed("access_denied"),
            CalendarReturn.parse("summaryai://calendar/error?message=access_denied")
        )
        assertEquals(CalendarReturn.Failed(""), CalendarReturn.parse("summaryai://calendar/error"))
    }

    @Test fun `ignores every other link`() {
        for (link in listOf(null, "", "summaryai://auth/callback", "summaryai://calendar/other", "https://calendar/error", "not a link %%")) {
            assertNull(link, CalendarReturn.parse(link))
        }
    }

    @Test fun `takes nothing from the link as text to show`() {
        assertEquals(CalendarReturn.Connected(null), CalendarReturn.parse("summaryai://calendar/connected?provider=Your+account+is+locked"))
        assertEquals(R.string.calendar_return_failed, CalendarReturn.errorMessage("Call%20this%20number"))
    }

    @Test fun `each known code has its own message`() {
        assertEquals(R.string.calendar_return_cancelled, CalendarReturn.errorMessage("access_denied"))
        assertEquals(R.string.calendar_return_expired, CalendarReturn.errorMessage("state_expired"))
        assertEquals(R.string.calendar_return_expired, CalendarReturn.errorMessage("invalid_state"))
        assertEquals(R.string.calendar_return_admin_approval, CalendarReturn.errorMessage("admin_consent_required"))
        for (code in listOf("callback_failed", "save_failed", "missing_params", "")) {
            assertEquals(R.string.calendar_return_failed, CalendarReturn.errorMessage(code))
        }
    }

    @Test fun `the result waits until the screen has shown it, and other links do not clear it`() {
        val store = CalendarReturnStore()
        store.offer("summaryai://calendar/error?message=callback_failed")
        store.offer(null)
        store.offer("summaryai://auth/callback")
        assertEquals(CalendarReturn.Failed("callback_failed"), store.pending.value)
        // A message that was cut short by a newer result must not clear the newer one.
        store.consume(CalendarReturn.Connected("google"))
        assertEquals(CalendarReturn.Failed("callback_failed"), store.pending.value)
        store.consume(CalendarReturn.Failed("callback_failed"))
        assertNull(store.pending.value)
    }
}
