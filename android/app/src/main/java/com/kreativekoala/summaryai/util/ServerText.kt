package com.kreativekoala.summaryai.util

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import com.kreativekoala.summaryai.R

/**
 * Text the server stores in English as data but the app shows to people: the title of a phone-call recording
 * ("Call with Maria", "Call to +1 415 555 0100") and generated speaker labels ("Speaker 2"). The server keeps writing
 * them in English (they are stored values, other clients read them); this app recognises exactly those patterns and
 * renders them from string resources in the user's language. Anything else, such as a title the user typed, is shown as is.
 */
object ServerText {
    private val CALL_WITH = Regex("^Call with (.+)$")
    private val CALL_TO = Regex("^Call to (.+)$")
    private val SPEAKER = Regex("^Speaker (\\d+)$")

    /** Which resource and argument a server title maps to, or null when it is not a generated one. For tests. */
    internal fun titleMatch(raw: String): Pair<Int, String>? {
        CALL_WITH.matchEntire(raw)?.let { return R.string.server_title_call_with to it.groupValues[1] }
        CALL_TO.matchEntire(raw)?.let { return R.string.server_title_call_to to it.groupValues[1] }
        return null
    }

    internal fun speakerMatch(raw: String): Pair<Int, Int>? =
        SPEAKER.matchEntire(raw)?.groupValues?.get(1)?.toIntOrNull()?.let { R.string.server_speaker_numbered to it }

    fun title(context: Context, raw: String): String {
        val m = titleMatch(raw) ?: return raw
        return context.getString(m.first, m.second)
    }

    fun speakerLabel(context: Context, raw: String): String {
        val m = speakerMatch(raw) ?: return raw
        return context.getString(m.first, m.second)
    }
}

@Composable
fun serverTitle(raw: String): String = ServerText.title(LocalContext.current, raw)

@Composable
fun serverSpeakerLabel(raw: String): String = ServerText.speakerLabel(LocalContext.current, raw)
