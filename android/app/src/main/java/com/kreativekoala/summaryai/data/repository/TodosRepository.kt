package com.kreativekoala.summaryai.data.repository

import com.kreativekoala.summaryai.data.api.SummaryAIApi
import com.kreativekoala.summaryai.data.api.models.*
import com.kreativekoala.summaryai.domain.model.Todo
import com.kreativekoala.summaryai.domain.model.TodoPriority as DomainPriority
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Repository for todo-related operations
 */
@Singleton
class TodosRepository @Inject constructor(
    private val api: SummaryAIApi
) {
    /**
     * Get all todos with optional filters
     */
    suspend fun getTodos(
        page: Int = 1,
        perPage: Int = 50,
        isCompleted: Boolean? = null,
        recordingId: String? = null
    ): Result<List<Todo>> = withContext(Dispatchers.IO) {
        try {
            val response = api.getTodos(
                page = page,
                perPage = perPage,
                isCompleted = isCompleted,
                recordingId = recordingId
            )
            Result.success(response.todos.map { it.toDomain() })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get a single todo
     */
    suspend fun getTodo(id: String): Result<Todo> = withContext(Dispatchers.IO) {
        try {
            val response = api.getTodo(id)
            Result.success(response.todo.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Create a new todo
     */
    suspend fun createTodo(
        title: String,
        notes: String? = null,
        recordingId: String? = null,
        priority: DomainPriority = DomainPriority.NONE,
        dueDate: String? = null
    ): Result<Todo> = withContext(Dispatchers.IO) {
        try {
            val response = api.createTodo(
                CreateTodoRequest(
                    title = title,
                    notes = notes,
                    recordingId = recordingId,
                    priority = priority.toApi(),
                    dueDate = dueDate
                )
            )
            Result.success(response.todo.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Update a todo
     */
    suspend fun updateTodo(
        id: String,
        title: String? = null,
        notes: String? = null,
        isCompleted: Boolean? = null,
        priority: DomainPriority? = null,
        dueDate: String? = null
    ): Result<Todo> = withContext(Dispatchers.IO) {
        try {
            val response = api.updateTodo(
                id = id,
                request = UpdateTodoRequest(
                    title = title,
                    notes = notes,
                    isCompleted = isCompleted,
                    priority = priority?.toApi(),
                    dueDate = dueDate
                )
            )
            Result.success(response.todo.toDomain())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Toggle todo completion status
     */
    suspend fun toggleTodo(id: String, isCompleted: Boolean): Result<Todo> {
        return updateTodo(id = id, isCompleted = isCompleted)
    }

    /**
     * Delete a todo
     */
    suspend fun deleteTodo(id: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            api.deleteTodo(id)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

// Extension functions to convert between domain and API models
private fun TodoDto.toDomain() = Todo(
    id = id,
    title = title,
    notes = notes,
    isCompleted = isCompleted,
    priority = priority.toDomain(),
    dueDate = dueDate,
    recordingId = recordingId,
    createdAt = createdAt
)

private fun TodoPriority.toDomain(): DomainPriority = when (this) {
    TodoPriority.HIGH -> DomainPriority.HIGH
    TodoPriority.MEDIUM -> DomainPriority.MEDIUM
    TodoPriority.LOW -> DomainPriority.LOW
    TodoPriority.NONE -> DomainPriority.NONE
}

private fun DomainPriority.toApi(): TodoPriority = when (this) {
    DomainPriority.HIGH -> TodoPriority.HIGH
    DomainPriority.MEDIUM -> TodoPriority.MEDIUM
    DomainPriority.LOW -> TodoPriority.LOW
    DomainPriority.NONE -> TodoPriority.NONE
}
