package com.kreativekoala.summaryai.ui.meetings

import com.google.gson.Gson
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.BotStateDto
import com.kreativekoala.summaryai.data.api.models.MeetingDetailDto
import com.kreativekoala.summaryai.ui.coaching.CoachingPhase
import com.kreativekoala.summaryai.ui.coaching.CoachingStartFailure
import com.kreativekoala.summaryai.ui.coaching.CoachingState
import com.kreativekoala.summaryai.ui.coaching.coachingCreditText
import com.kreativekoala.summaryai.ui.coaching.coachingStatusText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BotStatusTest {
    private fun notice(state: String, code: String? = null, joined: Boolean? = false) = botNotice(BotStateDto(state, code, joined))

    @Test fun theWaitingRoomAsksTheUserToLetTheBotIn() {
        val n = notice("waiting_room")!!
        assertEquals(R.string.bot_status_waiting_title, n.title)
        assertEquals(R.string.bot_status_waiting_body, n.body)
        assertFalse(n.failed)
    }

    @Test fun refusedAndTimedOutSayWhatHappenedAndWhatToDo() {
        assertEquals(R.string.bot_failed_not_admitted, notice("failed", "timeout_exceeded_waiting_room")!!.body)
        assertEquals(R.string.bot_failed_removed_waiting, notice("failed", "bot_kicked_from_waiting_room")!!.body)
        assertEquals(R.string.bot_failed_permission, notice("failed", "recording_permission_denied")!!.body)
        assertEquals(R.string.bot_failed_passcode, notice("failed", "meeting_password_incorrect")!!.body)
        assertEquals(R.string.bot_failed_generic, notice("failed", "something_new_from_the_provider")!!.body)
        assertEquals(R.string.bot_failed_generic, notice("failed", null)!!.body)
        assertTrue(notice("failed")!!.failed)
    }

    @Test fun aBotThatLeftWithoutEverJoiningFailed() {
        assertTrue(notice("ended", joined = false)!!.failed)
        assertNull(notice("ended", joined = true))
    }

    @Test fun aBotThatFailedAfterJoiningIsNeverSaidToHaveBeenUnableToJoin() {
        assertNull(notice("failed", null, joined = true))
        assertNull(notice("failed", "bot_fatal", joined = true))
        assertNull(notice("failed", "meeting_not_found", joined = true))
        assertEquals(R.string.bot_failed_permission, notice("failed", "recording_permission_denied", joined = true)!!.body)
    }

    @Test fun nothingToSayWhileRecordingOrWithoutAServerState() {
        assertNull(notice("recording", joined = true))
        assertNull(botNotice(null))
        assertNull(notice("a_state_added_later"))
    }

    @Test fun liveIndicatorOnlyOnceTheBotIsIn() {
        assertFalse(botIsInMeeting(BotStateDto("waiting_room")))
        assertFalse(botIsInMeeting(BotStateDto("joining")))
        assertTrue(botIsInMeeting(BotStateDto("recording")))
        assertTrue(botIsInMeeting(null))
    }

    @Test fun theServersFieldIsRead() {
        val detail = Gson().fromJson("""{"id":"m","bot_state":{"state":"failed","code":"meeting_not_found","joined":false}}""", MeetingDetailDto::class.java)
        assertEquals(R.string.bot_failed_link, botNotice(detail.botState)!!.body)
    }

    @Test fun theCoachSaysWhyItStoppedAndWhatHappenedToTheCredit() {
        val refused = CoachingState("m", CoachingPhase.ENDED, endReason = "bot_not_admitted", refunded = true)
        assertEquals(R.string.coach_ended_not_admitted, coachingStatusText(refused))
        assertEquals(R.string.coach_credit_returned, coachingCreditText(refused))
        val over = CoachingState("m", CoachingPhase.NOT_STARTED, startFailure = CoachingStartFailure.MEETING_OVER)
        assertEquals(R.string.coach_error_meeting_over, coachingStatusText(over))
        assertEquals(R.string.coach_no_credit_used, coachingCreditText(over))
        assertNull(coachingStatusText(CoachingState("m", CoachingPhase.LIVE)))
        assertNull(coachingCreditText(CoachingState("m", CoachingPhase.ENDED, refunded = false)))
    }
}
