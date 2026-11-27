package com.kreativekoala.summaryai.ui.meetings

import androidx.annotation.StringRes
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.BotStateDto

/** What to tell the user about the meeting bot: [body] says what is happening and what to do about it. */
data class BotNotice(@StringRes val title: Int, @StringRes val body: Int, val failed: Boolean = false)

/** Null when there is nothing to say (recording, ended normally, or a server that does not report the state). */
fun botNotice(bot: BotStateDto?): BotNotice? = when (bot?.state) {
    "joining" -> BotNotice(R.string.bot_status_joining_title, R.string.bot_status_joining_body)
    "waiting_room" -> BotNotice(R.string.bot_status_waiting_title, R.string.bot_status_waiting_body)
    "in_call" -> BotNotice(R.string.bot_status_in_call_title, R.string.bot_status_in_call_body)
    "failed" -> if (bot.joined == true) failedAfterJoining(bot.code) else failedNotice(bot.code)
    // Over without ever getting in.
    "ended" -> if (bot.joined == false) failedNotice(bot.code) else null
    else -> null
}

/** False only while the bot is known to be outside the meeting. */
fun botIsInMeeting(bot: BotStateDto?): Boolean = bot?.state !in setOf("joining", "waiting_room", "failed")

private fun failedNotice(code: String?) = BotNotice(R.string.bot_failed_title, botFailureText(code), failed = true)

/**
 * The bot got in and something failed later (the recording could not be stored, say): none of the joining advice is true.
 * Only a refused recording permission is still worth saying; otherwise the recording's own failed state speaks.
 */
private fun failedAfterJoining(code: String?): BotNotice? =
    failedNotice(code).takeIf { it.body == R.string.bot_failed_permission }

/** Recall sub codes and the server's own. Keep in step with web/src/lib/meetingFailure.ts. */
@StringRes
fun botFailureText(code: String?): Int = when (code) {
    "timeout_exceeded_waiting_room", "call_ended_by_platform_waiting_room_timeout" -> R.string.bot_failed_not_admitted
    "bot_kicked_from_waiting_room" -> R.string.bot_failed_removed_waiting
    "meeting_not_started" -> R.string.bot_failed_not_started
    "meeting_password_incorrect", "webex_password_required" -> R.string.bot_failed_passcode
    "meeting_not_found", "meeting_link_invalid", "meeting_link_expired" -> R.string.bot_failed_link
    "meeting_requires_sign_in", "meeting_requires_registration", "zoom_registration_required", "zoom_sso_login_required",
    "zoom_email_required", "zoom_anonymous_join_not_allowed", "zoom_authorized_participants_only",
    "google_meet_organisation_restricted" -> R.string.bot_failed_sign_in
    "zoom_bot_blocked", "google_meet_bot_blocked", "google_meet_knocking_disabled", "zoom_email_blocked_by_admin",
    "meeting_locked", "meeting_full" -> R.string.bot_failed_blocked
    "recording_permission_denied", "zoom_local_recording_disabled", "zoom_local_recording_request_disabled",
    "zoom_local_recording_request_disabled_by_host", "zoom_local_recording_request_denied_by_host",
    "zoom_local_recording_denied" -> R.string.bot_failed_permission
    else -> R.string.bot_failed_generic
}
