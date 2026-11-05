package com.kreativekoala.summaryai.service.voice

import kotlinx.coroutines.CancellationException
import java.time.LocalDate

/** The todo changes a spoken command can make. Behind an interface so the session is tested without a network. */
interface TodoMutations {
    suspend fun setCompleted(id: String, completed: Boolean): Boolean
    suspend fun delete(id: String): Boolean
}

sealed interface VoiceState {
    data object Idle : VoiceState

    /** A draft was read back; nothing is saved until a clear yes. [queue] holds further drafts from a debrief. */
    data class ConfirmingAction(
        val draft: ActionDraft,
        val queue: List<DebriefItem> = emptyList(),
        val recordingId: String? = null,
        val misses: Int = 0,
    ) : VoiceState

    /** The server could not read the spoken due date; the next utterance is taken as the date. */
    data class NeedDue(val request: ActionDraftRequest, val attempts: Int = 0) : VoiceState

    /** More than one item matched; the next utterance picks one. */
    data class Choosing(val candidates: List<VoiceAction>, val misses: Int = 0) : VoiceState

    /** A change was just made and can be taken back by voice until [expiresAtMs]. */
    data class Undoable(val kind: UndoKind, val todoId: String, val expiresAtMs: Long) : VoiceState

    /** Debrief read out; waiting for "save them" / "the first one" / no. */
    data class OfferSave(val recordingId: String, val items: List<DebriefItem>, val misses: Int = 0) : VoiceState

    /** Loudspeaker is in use: ask before reading a debrief aloud near other people. */
    data class AskReadAloud(val recordingId: String) : VoiceState
}

enum class UndoKind { CREATED, COMPLETED }

/**
 * What the screen should do after an utterance. [speech] is spoken (and shown). [listen] is true when the assistant
 * asked something, so the screen reopens the microphone. [openEditor] hands a draft to the add-todo dialog.
 */
data class VoiceReply(
    val speech: String,
    val state: VoiceState,
    val listen: Boolean = false,
    val openEditor: ActionDraft? = null,
    val debriefCounts: Pair<Int, Int>? = null,
)

/**
 * The conversation rules for hands-free actions, with no audio and no UI in it.
 *
 * Tiers (see VoiceFunnel for the matching events):
 *  - Reading is free: listing actions, reading a debrief.
 *  - Changing your own list is saved only after a read-back and a clear "yes". Silence, "no", or an answer that is not a
 *    yes all mean cancel. A saved change can be undone by voice for [UNDO_WINDOW_MS].
 *  - Nothing that another person can see is sent from here. Outward actions are prepared as a system intent and the
 *    user's own tap on the next screen is the confirmation (see [OutwardIntents]).
 */
class VoiceSession(
    private val client: VoiceToolsClient,
    private val todos: TodoMutations,
    private val funnel: VoiceFunnel,
    private val clock: () -> Long = System::currentTimeMillis,
    private val today: () -> LocalDate = { LocalDate.now() },
    private val timeZone: () -> String = { java.util.TimeZone.getDefault().id },
    private val loudspeaker: () -> Boolean = { false },
) {
    var state: VoiceState = VoiceState.Idle
        private set

    /** The meeting on screen, if any; "debrief" refers to it. */
    var currentRecordingId: String? = null

    // ---- entry points ---------------------------------------------------------------------------------------------

    suspend fun onHeard(text: String): VoiceReply = guarded {
        val s = state
        when (s) {
            is VoiceState.ConfirmingAction -> confirmReply(s, text)
            is VoiceState.NeedDue -> dueReply(s, text)
            is VoiceState.Choosing -> choiceReply(s, text)
            is VoiceState.OfferSave -> offerReply(s, text)
            is VoiceState.AskReadAloud -> readAloudReply(s, text)
            is VoiceState.Undoable -> undoOrCommand(s, text)
            VoiceState.Idle -> command(text)
        }
    }

    /** The user said nothing after a question. Never saves. */
    suspend fun onSilence(): VoiceReply = guarded {
        when (val s = state) {
            is VoiceState.ConfirmingAction -> {
                funnel.log(VoiceEvents.ACTION_CANCELLED, mapOf("reason" to "silence"))
                finishOrNext(s, "No answer, so nothing was saved.")
            }
            is VoiceState.NeedDue, is VoiceState.Choosing, is VoiceState.OfferSave, is VoiceState.AskReadAloud ->
                to(VoiceState.Idle, "No answer. I stopped.")
            else -> to(VoiceState.Idle, "")
        }
    }

    /** Start the spoken debrief of one meeting (the entry on the meeting screen). */
    suspend fun startDebrief(recordingId: String): VoiceReply = guarded {
        currentRecordingId = recordingId
        startDebriefInternal(recordingId)
    }

    fun reset() {
        state = VoiceState.Idle
    }

    // ---- commands -------------------------------------------------------------------------------------------------

    private suspend fun command(text: String): VoiceReply {
        return when (val intent = VoiceIntentParser.parse(text)) {
            is VoiceIntent.AddAction -> {
                val req = ActionDraftRequest(
                    title = intent.title,
                    assignee = intent.assignee,
                    dueText = intent.dueText,
                    timeZone = timeZone(),
                    recordingId = currentRecordingId,
                )
                draftAndRead(req, queue = emptyList(), recordingId = null)
            }
            VoiceIntent.ListOpen -> listOpen()
            is VoiceIntent.MarkDone -> markDone(intent.query)
            VoiceIntent.Debrief -> {
                val id = currentRecordingId
                if (id == null) {
                    to(VoiceState.Idle, "Open a meeting first, then ask for its debrief.")
                } else {
                    startDebriefInternal(id)
                }
            }
            VoiceIntent.Undo -> to(VoiceState.Idle, "There is nothing to undo.")
            VoiceIntent.Stop -> to(VoiceState.Idle, "OK.")
            VoiceIntent.Unknown -> {
                funnel.notUnderstood("no_match")
                to(VoiceState.Idle, "Sorry, I did not get that. You can say: add an action item, what are my open actions, or mark one done.")
            }
        }
    }

    private suspend fun startDebriefInternal(id: String): VoiceReply =
        if (loudspeaker()) to(VoiceState.AskReadAloud(id), "Your phone is on speaker. Read the debrief out loud?", listen = true) else readDebrief(id)

    private suspend fun draftAndRead(req: ActionDraftRequest, queue: List<DebriefItem>, recordingId: String?, attempts: Int = 0): VoiceReply {
        val draft = try {
            client.draftAction(req)
        } catch (e: DueNotUnderstood) {
            if (attempts >= 1) {
                funnel.log(VoiceEvents.ACTION_CANCELLED, mapOf("reason" to "due_unreadable"))
                return finishOrNextQueue(queue, recordingId, "I could not read that date, so nothing was saved.")
            }
            return to(VoiceState.NeedDue(req, attempts + 1), "What date should I use?", listen = true)
        }
        funnel.actionDrafted(hasDue = draft.dueDate != null, hasOwner = !draft.assignee.isNullOrBlank())
        return to(
            VoiceState.ConfirmingAction(draft, queue, recordingId ?: draft.recordingId),
            SpokenText.readback(draft, today()),
            listen = true,
        )
    }

    private suspend fun dueReply(s: VoiceState.NeedDue, text: String): VoiceReply {
        return when (VoiceIntentParser.parseReply(text)) {
            VoiceReplyIntent.No, VoiceReplyIntent.Undo -> {
                funnel.log(VoiceEvents.ACTION_CANCELLED, mapOf("reason" to "declined"))
                to(VoiceState.Idle, "Cancelled. Nothing saved.")
            }
            else -> draftAndRead(s.request.copy(dueText = VoiceIntentParser.clean(text)), emptyList(), null, attempts = s.attempts)
        }
    }

    private suspend fun confirmReply(s: VoiceState.ConfirmingAction, text: String): VoiceReply {
        return when (VoiceIntentParser.parseReply(text)) {
            VoiceReplyIntent.Yes -> commit(s)
            VoiceReplyIntent.No, VoiceReplyIntent.Undo -> {
                funnel.log(VoiceEvents.ACTION_CANCELLED, mapOf("reason" to "declined"))
                finishOrNext(s, "Cancelled. Nothing saved.")
            }
            VoiceReplyIntent.Edit -> {
                funnel.actionConfirmed(edited = true)
                VoiceReply("Opening it so you can edit.", VoiceState.Idle.also { state = it }, openEditor = s.draft)
            }
            else -> {
                if (s.misses >= 1) {
                    funnel.log(VoiceEvents.ACTION_CANCELLED, mapOf("reason" to "unclear"))
                    finishOrNext(s, "I did not hear a yes, so nothing was saved.")
                } else {
                    to(s.copy(misses = s.misses + 1), "Say yes to save, no to cancel, or edit to change it.", listen = true)
                }
            }
        }
    }

    private suspend fun commit(s: VoiceState.ConfirmingAction): VoiceReply {
        val saved = try {
            client.commitAction(s.draft.draftId)
        } catch (e: DraftExpired) {
            return finishOrNext(s, "That draft expired, so nothing was saved. Say it again.")
        }
        funnel.actionConfirmed(edited = false)
        return if (s.queue.isEmpty()) {
            to(
                VoiceState.Undoable(UndoKind.CREATED, saved.todoId, clock() + UNDO_WINDOW_MS),
                "Saved. Say undo in the next ten seconds to take it back.",
            )
        } else {
            nextQueued(s.queue, s.recordingId, "Saved.")
        }
    }

    private suspend fun finishOrNext(s: VoiceState.ConfirmingAction, lead: String): VoiceReply =
        finishOrNextQueue(s.queue, s.recordingId, lead)

    private suspend fun finishOrNextQueue(queue: List<DebriefItem>, recordingId: String?, lead: String): VoiceReply =
        if (queue.isEmpty()) to(VoiceState.Idle, lead) else nextQueued(queue, recordingId, lead)

    private suspend fun nextQueued(queue: List<DebriefItem>, recordingId: String?, lead: String): VoiceReply {
        val item = queue.first()
        val rest = queue.drop(1)
        val req = ActionDraftRequest(
            title = item.text,
            assignee = item.owner,
            dueText = item.dueDate,
            timeZone = timeZone(),
            recordingId = recordingId,
            summaryItemKey = item.key,
        )
        val next = draftAndRead(req, rest, recordingId)
        return next.copy(speech = "$lead Next. ${next.speech}")
    }

    // ---- reading --------------------------------------------------------------------------------------------------

    private suspend fun listOpen(): VoiceReply {
        val actions = client.listActions(status = "open", assignee = "me", limit = 100)
        return to(VoiceState.Idle, SpokenText.openActions(actions, today()))
    }

    private suspend fun readDebrief(recordingId: String): VoiceReply {
        funnel.log(VoiceEvents.DEBRIEF_STARTED)
        val d = client.debrief(recordingId, timeZone())
        val speech = SpokenText.debrief(d, today())
        val counts = d.decisions.size to d.actions.size
        val next = if (d.actions.isNotEmpty()) VoiceState.OfferSave(recordingId, d.actions) else VoiceState.Idle
        return to(next, speech, listen = d.actions.isNotEmpty()).copy(debriefCounts = counts)
    }

    private suspend fun readAloudReply(s: VoiceState.AskReadAloud, text: String): VoiceReply =
        when (VoiceIntentParser.parseReply(text)) {
            VoiceReplyIntent.Yes -> readDebrief(s.recordingId)
            else -> to(VoiceState.Idle, "OK. Plug in headphones or turn the speaker off and ask again.")
        }

    private suspend fun offerReply(s: VoiceState.OfferSave, text: String): VoiceReply {
        val picked: List<DebriefItem>? = when (val r = VoiceIntentParser.parseReply(text)) {
            VoiceReplyIntent.All, VoiceReplyIntent.Yes -> s.items
            is VoiceReplyIntent.Pick -> listOfNotNull(s.items.getOrNull(r.index - 1))
            is VoiceReplyIntent.PickMany -> r.indexes.mapNotNull { s.items.getOrNull(it - 1) }
            VoiceReplyIntent.No, VoiceReplyIntent.Undo -> emptyList()
            else -> null
        }
        if (picked == null) {
            return if (s.misses >= 1) {
                to(VoiceState.Idle, "OK, I did not save any.")
            } else {
                to(s.copy(misses = 1), "Say save them, the first one, or no.", listen = true)
            }
        }
        if (picked.isEmpty()) return to(VoiceState.Idle, "OK, nothing saved.")
        return nextQueued(picked, s.recordingId, "OK.")
    }

    // ---- marking done ---------------------------------------------------------------------------------------------

    private suspend fun markDone(query: String): VoiceReply {
        val actions = client.listActions(status = "open", assignee = null, limit = 100)
        return when (val m = ActionMatcher.match(query, actions)) {
            ActionMatcher.Match.None -> to(VoiceState.Idle, "I could not find an open item like that.")
            is ActionMatcher.Match.One -> complete(m.action)
            is ActionMatcher.Match.Many -> {
                val names = m.actions.mapIndexed { i, a -> "${i + 1}, ${a.title.trimEnd('.')}" }.joinToString(". ")
                to(VoiceState.Choosing(m.actions), "${m.actions.size} match. $names. Which one?", listen = true)
            }
        }
    }

    private suspend fun choiceReply(s: VoiceState.Choosing, text: String): VoiceReply {
        val chosen: VoiceAction? = when (val r = VoiceIntentParser.parseReply(text)) {
            is VoiceReplyIntent.Pick -> s.candidates.getOrNull(r.index - 1)
            VoiceReplyIntent.No, VoiceReplyIntent.Undo -> return to(VoiceState.Idle, "Cancelled.")
            is VoiceReplyIntent.Other -> (ActionMatcher.match(r.text, s.candidates) as? ActionMatcher.Match.One)?.action
            else -> null
        }
        if (chosen != null) return complete(chosen)
        return if (s.misses >= 1) {
            to(VoiceState.Idle, "I could not tell which one, so I changed nothing.")
        } else {
            to(s.copy(misses = 1), "Say the number, like the first one.", listen = true)
        }
    }

    private suspend fun complete(a: VoiceAction): VoiceReply {
        if (!todos.setCompleted(a.id, true)) return to(VoiceState.Idle, "I could not update it. Nothing changed.")
        return to(
            VoiceState.Undoable(UndoKind.COMPLETED, a.id, clock() + UNDO_WINDOW_MS),
            "Marked ${a.title.trimEnd('.')} done. Say undo in the next ten seconds to reverse it.",
        )
    }

    // ---- undo -----------------------------------------------------------------------------------------------------

    private suspend fun undoOrCommand(s: VoiceState.Undoable, text: String): VoiceReply {
        val intent = VoiceIntentParser.parse(text)
        if (intent != VoiceIntent.Undo) {
            state = VoiceState.Idle
            return command(text)
        }
        if (clock() > s.expiresAtMs) {
            return to(VoiceState.Idle, "That is too late to undo by voice. You can change it on the screen.")
        }
        val ok = when (s.kind) {
            UndoKind.CREATED -> todos.delete(s.todoId)
            UndoKind.COMPLETED -> todos.setCompleted(s.todoId, false)
        }
        funnel.log(VoiceEvents.ACTION_UNDONE)
        return to(VoiceState.Idle, if (ok) "Undone." else "I could not undo it. You can change it on the screen.")
    }

    // ---- plumbing -------------------------------------------------------------------------------------------------

    private fun to(next: VoiceState, speech: String, listen: Boolean = false): VoiceReply {
        state = next
        return VoiceReply(speech, next, listen)
    }

    /** Server and network errors are spoken plainly; nothing is saved by a failed call. */
    private suspend fun guarded(block: suspend () -> VoiceReply): VoiceReply = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: VoiceUnavailable) {
        to(VoiceState.Idle, "Voice actions are not available right now.")
    } catch (e: Exception) {
        funnel.notUnderstood("server_error")
        to(VoiceState.Idle, "I could not reach the server. Nothing was saved.")
    }

    companion object {
        const val UNDO_WINDOW_MS = 10_000L
    }
}
