package com.kreativekoala.summaryai.domain.model

import androidx.compose.ui.graphics.Color
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

    val displayName: String
        get() = when (this) {
            HIGH -> "High"
            MEDIUM -> "Medium"
            LOW -> "Low"
            NONE -> "None"
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
    val createdAt: String
) {
    val hasDueDate: Boolean
        get() = dueDate != null

    val hasNotes: Boolean
        get() = !notes.isNullOrBlank()

    val isFromRecording: Boolean
        get() = recordingId != null
}
