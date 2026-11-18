package com.kreativekoala.summaryai.domain.model

import androidx.annotation.StringRes
import androidx.compose.ui.graphics.Color
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.ui.theme.Green50
import com.kreativekoala.summaryai.ui.theme.Orange50
import com.kreativekoala.summaryai.ui.theme.Red50
import com.kreativekoala.summaryai.ui.theme.Neutral50

/**
 * Todo priority levels
 */
enum class TodoPriority {
    HIGH,
    MEDIUM,
    LOW,
    NONE;

    @get:StringRes
    val labelRes: Int
        get() = when (this) {
            HIGH -> R.string.high
            MEDIUM -> R.string.medium
            LOW -> R.string.low
            NONE -> R.string.none
        }

    val color: Color
        get() = when (this) {
            HIGH -> Red50
            MEDIUM -> Orange50
            LOW -> Green50
            NONE -> Neutral50
        }
}

/**
 * Todo domain model
 */
data class Todo(
    val id: String,
    val title: String,
    val notes: String?,
    val isCompleted: Boolean,
    val priority: TodoPriority,
    val dueDate: String?,
    val recordingId: String?,
    val createdAt: String,
    val assignee: String? = null
) {
    /** Calendar date part (YYYY-MM-DD) of [dueDate], which may be a date or full ISO datetime. */
    val dueDateDisplay: String?
        get() = dueDate?.takeIf { it.length >= 10 }?.substring(0, 10)

    val hasAssignee: Boolean
        get() = !assignee.isNullOrBlank()

    val hasDueDate: Boolean
        get() = dueDate != null

    val hasNotes: Boolean
        get() = !notes.isNullOrBlank()

    val isFromRecording: Boolean
        get() = recordingId != null
}
