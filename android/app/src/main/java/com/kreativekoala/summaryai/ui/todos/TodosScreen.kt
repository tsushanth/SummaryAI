package com.kreativekoala.summaryai.ui.todos

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.Todo
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmChip
import com.kreativekoala.summaryai.ui.components.MmEmptyState
import com.kreativekoala.summaryai.ui.components.MmStatusPill
import com.kreativekoala.summaryai.ui.components.SkeletonCardList
import com.kreativekoala.summaryai.domain.model.TodoPriority

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodosScreen(
    viewModel: TodosViewModel = hiltViewModel(),
    onRecordingClick: (String) -> Unit,
    onBack: (() -> Unit)? = null
) {
    val uiState by viewModel.uiState.collectAsState()

    // Error handling
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.todos)) },
                navigationIcon = {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = stringResource(R.string.back)
                            )
                        }
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = viewModel::showAddDialog) {
                Icon(Icons.Default.Add, contentDescription = stringResource(R.string.add_todo))
            }
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Filter chips
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TodoFilter.values().forEach { filter ->
                    MmChip(
                        label = when (filter) {
                            TodoFilter.ALL -> stringResource(R.string.all)
                            TodoFilter.PENDING -> stringResource(R.string.pending_items)
                            TodoFilter.COMPLETED -> stringResource(R.string.completed_items)
                        },
                        selected = uiState.filter == filter,
                        onClick = { viewModel.setFilter(filter) }
                    )
                }
            }

            // Content
            if (uiState.isLoading) {
                SkeletonCardList(count = 5, loadingDescription = stringResource(R.string.ui_loading))
            } else if (uiState.todos.isEmpty()) {
                EmptyTodosContent(filter = uiState.filter)
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(
                        items = uiState.todos,
                        key = { it.id }
                    ) { todo ->
                        TodoItem(
                            todo = todo,
                            onToggle = { viewModel.toggleTodo(todo) },
                            onDelete = { viewModel.deleteTodo(todo) },
                            onEdit = { viewModel.showEditDialog(todo) },
                            onRecordingClick = todo.recordingId?.let { { onRecordingClick(it) } }
                        )
                    }
                }
            }
        }

        // Add Todo Dialog
        if (uiState.showAddDialog) {
            AddTodoDialog(
                title = uiState.newTodoTitle,
                notes = uiState.newTodoNotes,
                priority = uiState.newTodoPriority,
                assignee = uiState.newTodoAssignee,
                dueDate = uiState.newTodoDueDate,
                isEditing = uiState.editingTodoId != null,
                onAssigneeChange = viewModel::updateNewTodoAssignee,
                onDueDateChange = viewModel::updateNewTodoDueDate,
                onTitleChange = viewModel::updateNewTodoTitle,
                onNotesChange = viewModel::updateNewTodoNotes,
                onPriorityChange = viewModel::updateNewTodoPriority,
                onDismiss = viewModel::hideAddDialog,
                onConfirm = viewModel::createTodo
            )
        }
    }
}

@Composable
private fun EmptyTodosContent(filter: TodoFilter) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        MmEmptyState(
            icon = Icons.Default.Checklist,
            title = when (filter) {
                TodoFilter.ALL -> stringResource(R.string.no_action_items)
                TodoFilter.PENDING -> stringResource(R.string.no_pending_items)
                TodoFilter.COMPLETED -> stringResource(R.string.no_completed_items)
            },
            message = stringResource(R.string.action_items_empty_hint)
        )
    }
}

@Composable
private fun TodoItem(
    todo: Todo,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
    onEdit: () -> Unit,
    onRecordingClick: (() -> Unit)?
) {
    var showMenu by remember { mutableStateOf(false) }

    MmCard {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            Checkbox(
                checked = todo.isCompleted,
                onCheckedChange = { onToggle() }
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 8.dp)
            ) {
                Text(
                    text = todo.title,
                    style = MaterialTheme.typography.bodyLarge,
                    textDecoration = if (todo.isCompleted) TextDecoration.LineThrough else null,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                if (todo.hasNotes) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = todo.notes!!,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Priority badge
                    if (todo.priority != TodoPriority.NONE) {
                        MmStatusPill(
                            text = todo.priority.displayName,
                            container = todo.priority.color.copy(alpha = 0.2f),
                            content = todo.priority.color
                        )
                    }

                    TodoMetaChips(todo)

                    // Recording link
                    if (todo.isFromRecording && onRecordingClick != null) {
                        TextButton(
                            onClick = onRecordingClick,
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp)
                        ) {
                            Icon(
                                Icons.Default.Mic,
                                contentDescription = null,
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(stringResource(R.string.view_recording), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }

            Box {
                IconButton(onClick = { showMenu = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.more))
                }

                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false }
                ) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.edit)) },
                        onClick = {
                            showMenu = false
                            onEdit()
                        },
                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null) }
                    )
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.delete)) },
                        onClick = {
                            showMenu = false
                            onDelete()
                        },
                        leadingIcon = {
                            Icon(
                                Icons.Default.Delete,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun AddTodoDialog(
    title: String,
    notes: String,
    priority: TodoPriority,
    assignee: String,
    dueDate: String,
    isEditing: Boolean,
    onAssigneeChange: (String) -> Unit,
    onDueDateChange: (String) -> Unit,
    onTitleChange: (String) -> Unit,
    onNotesChange: (String) -> Unit,
    onPriorityChange: (TodoPriority) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(if (isEditing) R.string.edit else R.string.add_todo)) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                OutlinedTextField(
                    value = title,
                    onValueChange = onTitleChange,
                    label = { Text(stringResource(R.string.todo_title)) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.medium,
                    singleLine = true
                )

                OutlinedTextField(
                    value = notes,
                    onValueChange = onNotesChange,
                    label = { Text(stringResource(R.string.todo_notes)) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    maxLines = 4
                )

                TodoAssigneeAndDueFields(
                    assignee = assignee,
                    dueDate = dueDate,
                    onAssigneeChange = onAssigneeChange,
                    onDueDateChange = onDueDateChange
                )

                // Priority selector
                Text(
                    text = stringResource(R.string.priority),
                    style = MaterialTheme.typography.labelMedium
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TodoPriority.values().forEach { p ->
                        MmChip(
                            label = p.displayName,
                            selected = priority == p,
                            onClick = { onPriorityChange(p) }
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = title.isNotBlank()
            ) {
                Text(stringResource(if (isEditing) R.string.save else R.string.add))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
