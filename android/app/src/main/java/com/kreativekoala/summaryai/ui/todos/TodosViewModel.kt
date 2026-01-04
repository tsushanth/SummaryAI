package com.kreativekoala.summaryai.ui.todos

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.data.repository.TodosRepository
import com.kreativekoala.summaryai.domain.model.Todo
import com.kreativekoala.summaryai.domain.model.TodoPriority
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class TodoFilter {
    ALL,
    PENDING,
    COMPLETED
}

data class TodosUiState(
    val todos: List<Todo> = emptyList(),
    val isLoading: Boolean = false,
    val filter: TodoFilter = TodoFilter.PENDING,
    val error: String? = null,
    val showAddDialog: Boolean = false,
    val newTodoTitle: String = "",
    val newTodoNotes: String = "",
    val newTodoPriority: TodoPriority = TodoPriority.NONE
)

@HiltViewModel
class TodosViewModel @Inject constructor(
    private val todosRepository: TodosRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TodosUiState())
    val uiState: StateFlow<TodosUiState> = _uiState.asStateFlow()

    init {
        loadTodos()
    }

    fun setFilter(filter: TodoFilter) {
        _uiState.value = _uiState.value.copy(filter = filter)
        loadTodos()
    }

    fun showAddDialog() {
        _uiState.value = _uiState.value.copy(
            showAddDialog = true,
            newTodoTitle = "",
            newTodoNotes = "",
            newTodoPriority = TodoPriority.NONE
        )
    }

    fun hideAddDialog() {
        _uiState.value = _uiState.value.copy(showAddDialog = false)
    }

    fun updateNewTodoTitle(title: String) {
        _uiState.value = _uiState.value.copy(newTodoTitle = title)
    }

    fun updateNewTodoNotes(notes: String) {
        _uiState.value = _uiState.value.copy(newTodoNotes = notes)
    }

    fun updateNewTodoPriority(priority: TodoPriority) {
        _uiState.value = _uiState.value.copy(newTodoPriority = priority)
    }

    fun createTodo() {
        val state = _uiState.value
        if (state.newTodoTitle.isBlank()) return

        viewModelScope.launch {
            val result = todosRepository.createTodo(
                title = state.newTodoTitle,
                notes = state.newTodoNotes.ifBlank { null },
                priority = state.newTodoPriority
            )

            result.fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(showAddDialog = false)
                    loadTodos()
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(error = error.message)
                }
            )
        }
    }

    fun toggleTodo(todo: Todo) {
        viewModelScope.launch {
            val result = todosRepository.toggleTodo(todo.id, !todo.isCompleted)

            result.fold(
                onSuccess = { updatedTodo ->
                    val updatedList = _uiState.value.todos.map {
                        if (it.id == updatedTodo.id) updatedTodo else it
                    }
                    _uiState.value = _uiState.value.copy(todos = updatedList)
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(error = error.message)
                }
            )
        }
    }

    fun deleteTodo(todo: Todo) {
        viewModelScope.launch {
            val result = todosRepository.deleteTodo(todo.id)

            result.fold(
                onSuccess = {
                    val updatedList = _uiState.value.todos.filter { it.id != todo.id }
                    _uiState.value = _uiState.value.copy(todos = updatedList)
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(error = error.message)
                }
            )
        }
    }

    private fun loadTodos() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            val isCompleted = when (_uiState.value.filter) {
                TodoFilter.ALL -> null
                TodoFilter.PENDING -> false
                TodoFilter.COMPLETED -> true
            }

            val result = todosRepository.getTodos(isCompleted = isCompleted)

            result.fold(
                onSuccess = { todos ->
                    _uiState.value = _uiState.value.copy(
                        todos = todos,
                        isLoading = false,
                        error = null
                    )
                },
                onFailure = { error ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = error.message
                    )
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
