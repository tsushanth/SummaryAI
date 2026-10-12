package com.kreativekoala.summaryai.ui.todos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.domain.model.Todo
import com.kreativekoala.summaryai.ui.components.MmStatusPill
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** Assignee text field plus a due-date field backed by a Material 3 date picker. Date is YYYY-MM-DD or empty. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TodoAssigneeAndDueFields(
    assignee: String,
    dueDate: String,
    onAssigneeChange: (String) -> Unit,
    onDueDateChange: (String) -> Unit
) {
    var showPicker by remember { mutableStateOf(false) }

    OutlinedTextField(
        value = assignee,
        onValueChange = onAssigneeChange,
        label = { Text(stringResource(R.string.todo_assignee)) },
        leadingIcon = { Icon(Icons.Default.Person, contentDescription = null) },
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        singleLine = true
    )

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        TextButton(onClick = { showPicker = true }, modifier = Modifier.weight(1f)) {
            Icon(Icons.Default.CalendarToday, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
            Text(
                if (dueDate.isBlank()) stringResource(R.string.todo_due_date)
                else stringResource(R.string.todo_due_chip, dueDate)
            )
        }
        if (dueDate.isNotBlank()) {
            IconButton(onClick = { onDueDateChange("") }) {
                Icon(Icons.Default.Clear, contentDescription = stringResource(R.string.todo_due_date_clear))
            }
        }
    }

    if (showPicker) {
        val initialMillis = runCatching {
            LocalDate.parse(dueDate).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli()
        }.getOrNull()
        val state = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showPicker = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { ms ->
                        onDueDateChange(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString())
                    }
                    showPicker = false
                }) { Text(stringResource(R.string.todo_due_date_pick)) }
            },
            dismissButton = {
                TextButton(onClick = { showPicker = false }) { Text(stringResource(R.string.cancel)) }
            }
        ) { DatePicker(state = state) }
    }
}

/** Assignee and due-date chips shown on a todo row. Emits nothing when neither is set. */
@Composable
internal fun TodoMetaChips(todo: Todo) {
    if (todo.hasAssignee) {
        MmStatusPill(text = todo.assignee!!)
    }
    todo.dueDateDisplay?.let {
        MmStatusPill(text = stringResource(R.string.todo_due_chip, it))
    }
}
