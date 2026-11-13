package com.kreativekoala.summaryai.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.repository.VoiceAssistantRepository
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmSectionHeader
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class VoiceAssistantUiState(
    /** First load in flight. */
    val loading: Boolean = true,
    /** The first load failed (offline, signed out, server error): the switch is hidden and a retry is offered. */
    val loadFailed: Boolean = false,
    val enabled: Boolean = true,
    /** A save is in flight: the switch is locked so taps cannot race each other. */
    val saving: Boolean = false,
    /** The last save failed and the switch was put back to what the server has. */
    val saveFailed: Boolean = false
)

/**
 * The in-meeting voice assistant switch (backend GET/PUT /api/voice-assistant). Optimistic: the switch flips at once and goes
 * back if the save fails. Never throws: the repository returns failures as Results.
 */
@HiltViewModel
class VoiceAssistantViewModel @Inject constructor(
    private val repository: VoiceAssistantRepository
) : ViewModel() {
    private val _state = MutableStateFlow(VoiceAssistantUiState())
    val state: StateFlow<VoiceAssistantUiState> = _state.asStateFlow()

    /** Loads (or reloads after a failure) the saved state. */
    fun refresh() {
        if (!_state.value.loading && !_state.value.loadFailed) return
        viewModelScope.launch { load() }
    }

    fun setEnabled(enabled: Boolean) {
        viewModelScope.launch { save(enabled) }
    }

    internal suspend fun load() {
        _state.update { it.copy(loading = true, loadFailed = false) }
        repository.load().fold(
            onSuccess = { on -> _state.update { it.copy(loading = false, loadFailed = false, enabled = on) } },
            onFailure = { _state.update { s -> s.copy(loading = false, loadFailed = true) } }
        )
    }

    internal suspend fun save(enabled: Boolean) {
        val current = _state.value
        if (current.loading || current.loadFailed || current.saving || current.enabled == enabled) return
        val previous = current.enabled
        _state.update { it.copy(enabled = enabled, saving = true, saveFailed = false) }
        repository.save(enabled).fold(
            onSuccess = { stored -> _state.update { it.copy(enabled = stored, saving = false) } },
            // Roll back so the switch never shows a choice the server did not store
            onFailure = { _state.update { s -> s.copy(enabled = previous, saving = false, saveFailed = true) } }
        )
    }
}

/** Settings section with the "Voice assistant in meetings" switch. */
@Composable
fun VoiceAssistantSection(viewModel: VoiceAssistantViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(Unit) { viewModel.refresh() }

    Column(modifier = Modifier.padding(vertical = 8.dp)) {
        MmSectionHeader(
            title = stringResource(R.string.voice_assistant_section),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
        )
        MmCard(modifier = Modifier.padding(horizontal = 16.dp)) {
            Column {
                val title = stringResource(R.string.voice_assistant_title)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .defaultMinSize(minHeight = 56.dp)
                        .toggleable(
                            value = state.enabled,
                            enabled = !state.loading && !state.loadFailed && !state.saving,
                            role = Role.Switch,
                            onValueChange = viewModel::setEnabled
                        )
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.Default.RecordVoiceOver,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.width(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = title, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            text = stringResource(R.string.voice_assistant_hint),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Spacer(modifier = Modifier.width(12.dp))
                    when {
                        state.loading -> CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                        state.loadFailed -> Unit
                        else -> Switch(checked = state.enabled, onCheckedChange = null, enabled = !state.saving)
                    }
                }
                if (state.loadFailed) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(start = 56.dp, end = 8.dp, bottom = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = stringResource(R.string.voice_assistant_load_error),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.weight(1f)
                        )
                        TextButton(onClick = viewModel::refresh) { Text(stringResource(R.string.retry)) }
                    }
                }
                if (state.saveFailed) {
                    Text(
                        text = stringResource(R.string.voice_assistant_save_error),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(start = 56.dp, end = 16.dp, bottom = 12.dp)
                    )
                }
            }
        }
    }
}
