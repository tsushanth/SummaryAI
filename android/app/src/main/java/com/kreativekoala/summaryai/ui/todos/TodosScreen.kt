package com.kreativekoala.summaryai.ui.todos

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
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
import com.kreativekoala.summaryai.domain.model.TodoPriority

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodosScreen(
    viewModel: TodosViewModel = hiltViewModel(),
    onRecordingClick: (String) -> Unit
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
                title = { Text(stringResource(R.string.todos)) }
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
                    FilterChip(
                        selected = uiState.filter == filter,
                        onClick = { viewModel.setFilter(filter) },
                        label = {
                            Text(
                                when (filter) {
                                    TodoFilter.ALL -> stringResource(R.string.all)
                                    TodoFilter.PENDING -> stringResource(R.string.pending_items)
                                    TodoFilter.COMPLETED -> stringResource(R.string.completed_items)
                                }
                            )
                        }
                    )
                }
            }

            // Content
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
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
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                imageVector = Icons.Default.Checklist,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = when (filter) {
                    TodoFilter.ALL -> stringResource(R.string.no_action_items)
                    TodoFilter.PENDING -> stringResource(R.string.no_pending_items)
                    TodoFilter.COMPLETED -> stringResource(R.string.no_completed_items)
                },
                style = MaterialTheme.typography.titleMedium
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.action_items_empty_hint),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun TodoItem(
    todo: Todo,
    onToggle: () -> Unit,
    onDelete: () -> Unit,
    onRecordingClick: (() -> Unit)?
) {
    var showMenu by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
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
                        Surface(
                            color = todo.priority.color.copy(alpha = 0.2f),
                            shape = MaterialTheme.shapes.small
                        ) {
                            Text(
                                text = todo.priority.displayName,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                style = MaterialTheme.typography.labelSmall,
                                color = todo.priority.color
                            )
                        }
                    }

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
    onTitleChange: (String) -> Unit,
    onNotesChange: (String) -> Unit,
    onPriorityChange: (TodoPriority) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_todo)) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                OutlinedTextField(
                    value = title,
                    onValueChange = onTitleChange,
                    label = { Text(stringResource(R.string.todo_title)) },
                    modifier = Modifier.fillMaxWidth(),
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

                // Priority selector
                Text(
                    text = stringResource(R.string.priority),
                    style = MaterialTheme.typography.labelMedium
                )
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TodoPriority.values().forEach { p ->
                        FilterChip(
                            selected = priority == p,
                            onClick = { onPriorityChange(p) },
                            label = { Text(p.displayName) }
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
                Text(stringResource(R.string.add))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}
