package com.kreativekoala.summaryai.service.voice

import com.google.gson.annotations.SerializedName
import com.kreativekoala.summaryai.data.api.SummaryAIApi
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What the hands-free features need from the server, and nothing more. The screens and [VoiceSession] only know this
 * interface, so they are tested with a fake and keep working unchanged when the transport behind it changes.
 *
 * The server side is off unless it is switched on for the account: every call then fails with [VoiceUnavailable]
 * (HTTP 404), which [VoiceFeatureGate] reads as "feature off".
 */
interface VoiceToolsClient {
    /** Cheap availability probe. Throws [VoiceUnavailable] when the server has the feature switched off. */
    suspend fun date(timeZone: String): VoiceDate

    /** Open or done actions, soonest due date first. */
    suspend fun listActions(status: String, assignee: String?, limit: Int): List<VoiceAction>

    /** Builds a draft. Nothing is saved. Throws [DueNotUnderstood] when the due text cannot be read. */
    suspend fun draftAction(request: ActionDraftRequest): ActionDraft

    /** Saves exactly the drafted fields, once. Returns the todo id. */
    suspend fun commitAction(draftId: String): CommittedAction

    /** Decisions and actions of one meeting, each backed by a transcript quote on the server. */
    suspend fun debrief(recordingId: String, timeZone: String): Debrief
}

class VoiceUnavailable : Exception("Voice tools are not available for this account")
class DueNotUnderstood : Exception("The due date could not be read")
class DraftExpired : Exception("The draft is no longer valid")

data class VoiceDate(val today: String, val weekday: String, val timeZone: String)

data class VoiceAction(
    val id: String,
    /** "todo" (can be completed here) or "summary_item" (from a meeting summary, not in the list yet). */
    val kind: String,
    val title: String,
    val assignee: String?,
    val dueDate: String?,
    val isCompleted: Boolean,
    val recordingId: String?,
    val meetingTitle: String?,
    val key: String?,
) {
    val isTodo: Boolean get() = kind == "todo"
}

data class ActionDraftRequest(
    val title: String,
    val assignee: String? = null,
    /** As said ("friday") or an ISO date. The server resolves it; the app never guesses a date. */
    val dueText: String? = null,
    val timeZone: String,
    val recordingId: String? = null,
    val summaryItemKey: String? = null,
)

data class ActionDraft(
    val draftId: String,
    val title: String,
    val assignee: String?,
    val dueDate: String?,
    val priority: String,
    val recordingId: String?,
    val summaryItemKey: String?,
)

data class CommittedAction(val todoId: String, val created: Boolean)

data class DebriefItem(val text: String, val owner: String?, val dueDate: String?, val key: String?)

data class Debrief(
    val recordingId: String,
    val title: String?,
    val decisions: List<DebriefItem>,
    val actions: List<DebriefItem>,
    val truncated: Boolean,
    val note: String?,
)

// ---- wire format -------------------------------------------------------------------------------------------------

data class DateDto(val today: String, val weekday: String, val timezone: String)

data class ActionRowDto(
    val id: String,
    val kind: String,
    val title: String,
    val assignee: String?,
    @SerializedName("due_date") val dueDate: String?,
    @SerializedName("is_completed") val isCompleted: Boolean,
    @SerializedName("recording_id") val recordingId: String?,
    @SerializedName("meeting_title") val meetingTitle: String?,
    val key: String?,
)

data class ActionsResponseDto(val total: Int = 0, val actions: List<ActionRowDto> = emptyList())

data class DraftRequestDto(
    val title: String,
    val assignee: String?,
    val due: String?,
    val tz: String,
    @SerializedName("recording_id") val recordingId: String?,
    @SerializedName("summary_item_key") val summaryItemKey: String?,
)

data class DraftFieldsDto(
    val title: String,
    val assignee: String?,
    @SerializedName("due_date") val dueDate: String?,
    val priority: String = "none",
    @SerializedName("recording_id") val recordingId: String?,
    @SerializedName("summary_item_key") val summaryItemKey: String?,
)

data class DraftResponseDto(
    @SerializedName("draft_id") val draftId: String,
    val fields: DraftFieldsDto,
)

data class CommitRequestDto(@SerializedName("draft_id") val draftId: String)

data class CommitTodoDto(val id: String)

data class CommitResponseDto(val todo: CommitTodoDto, val created: Boolean = true)

data class DebriefItemDto(
    val text: String,
    val owner: String? = null,
    @SerializedName("due_date") val dueDate: String? = null,
    val key: String? = null,
)

data class DebriefResponseDto(
    val id: String,
    val title: String? = null,
    val decisions: List<DebriefItemDto> = emptyList(),
    val actions: List<DebriefItemDto> = emptyList(),
    val truncated: Boolean = false,
    val note: String? = null,
)

/** Retrofit-backed client. On the availability probe HTTP 404 means the feature is off for this account; 422 DUE_NOT_UNDERSTOOD and 410 are mapped to typed errors. */
@Singleton
class RetrofitVoiceToolsClient @Inject constructor(private val api: SummaryAIApi) : VoiceToolsClient {

    override suspend fun date(timeZone: String): VoiceDate = call(offOn404 = true) {
        val d = api.voiceDate(timeZone)
        VoiceDate(d.today, d.weekday, d.timezone)
    }

    override suspend fun listActions(status: String, assignee: String?, limit: Int): List<VoiceAction> = call {
        api.voiceActions(status = status, assignee = assignee, limit = limit).actions.map {
            VoiceAction(it.id, it.kind, it.title, it.assignee, it.dueDate, it.isCompleted, it.recordingId, it.meetingTitle, it.key)
        }
    }

    override suspend fun draftAction(request: ActionDraftRequest): ActionDraft = call {
        val r = api.voiceDraftAction(
            DraftRequestDto(request.title, request.assignee, request.dueText, request.timeZone, request.recordingId, request.summaryItemKey)
        )
        ActionDraft(r.draftId, r.fields.title, r.fields.assignee, r.fields.dueDate, r.fields.priority, r.fields.recordingId, r.fields.summaryItemKey)
    }

    override suspend fun commitAction(draftId: String): CommittedAction = call {
        val r = api.voiceCommitAction(CommitRequestDto(draftId))
        CommittedAction(r.todo.id, r.created)
    }

    override suspend fun debrief(recordingId: String, timeZone: String): Debrief = call {
        val r = api.voiceDebrief(recordingId, timeZone)
        Debrief(
            recordingId = r.id,
            title = r.title,
            decisions = r.decisions.map { DebriefItem(it.text, it.owner, it.dueDate, it.key) },
            actions = r.actions.map { DebriefItem(it.text, it.owner, it.dueDate, it.key) },
            truncated = r.truncated,
            note = r.note,
        )
    }

    /** Only the availability probe treats 404 as "feature off"; on other calls it means the item does not exist. */
    private suspend fun <T> call(offOn404: Boolean = false, block: suspend () -> T): T = try {
        block()
    } catch (e: HttpException) {
        when (e.code()) {
            404 -> if (offOn404) throw VoiceUnavailable() else throw e
            410 -> throw DraftExpired()
            422 -> throw DueNotUnderstood()
            else -> throw e
        }
    }
}
