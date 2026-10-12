package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

// MARK: - Priority
enum class TodoPriority {
    @SerializedName("high") HIGH,
    @SerializedName("medium") MEDIUM,
    @SerializedName("low") LOW,
    @SerializedName("none") NONE
}

// MARK: - Todo
data class TodoDto(
    val id: String,
    @SerializedName("user_id") val userId: String,
    @SerializedName("recording_id") val recordingId: String?,
    val title: String,
    @SerializedName(value = "notes", alternate = ["description"]) val notes: String?,
    @SerializedName("is_completed") val isCompleted: Boolean,
    val priority: TodoPriority,
    @SerializedName("due_date") val dueDate: String?,
    @SerializedName("completed_at") val completedAt: String?,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("updated_at") val updatedAt: String,
    val assignee: String? = null
)

// MARK: - API Requests

data class CreateTodoRequest(
    val title: String,
    val notes: String? = null,
    @SerializedName("recording_id") val recordingId: String? = null,
    val priority: TodoPriority = TodoPriority.NONE,
    @SerializedName("due_date") val dueDate: String? = null,
    val assignee: String? = null
)

data class UpdateTodoRequest(
    val title: String? = null,
    val notes: String? = null,
    @SerializedName("is_completed") val isCompleted: Boolean? = null,
    val priority: TodoPriority? = null,
    @SerializedName("due_date") val dueDate: String? = null,
    val assignee: String? = null
)

// MARK: - API Responses

data class ListTodosResponse(
    val todos: List<TodoDto>,
    @SerializedName(value = "pagination", alternate = ["meta"]) val pagination: PaginationDto
)

data class TodoResponse(
    val todo: TodoDto
)
