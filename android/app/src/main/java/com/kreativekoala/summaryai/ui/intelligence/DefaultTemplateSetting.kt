package com.kreativekoala.summaryai.ui.intelligence

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
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
import com.kreativekoala.summaryai.data.api.models.SummaryTemplateDto
import com.kreativekoala.summaryai.data.repository.IntelligenceRepository
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmSectionHeader
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class DefaultTemplateState(
    val templates: List<SummaryTemplateDto> = emptyList(),
    val selected: String? = null,
    val error: Boolean = false
)

@HiltViewModel
class DefaultTemplateViewModel @Inject constructor(
    private val repository: IntelligenceRepository
) : ViewModel() {
    private val _state = MutableStateFlow(DefaultTemplateState())
    val state: StateFlow<DefaultTemplateState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getTemplates().fold(
                onSuccess = { r -> _state.update { it.copy(templates = r.templates, selected = r.defaultTemplate) } },
                onFailure = { _state.update { it.copy(error = true) } }
            )
        }
    }

    fun select(id: String) {
        val previous = _state.value.selected
        if (previous == id) return
        _state.update { it.copy(selected = id, error = false) }
        viewModelScope.launch {
            repository.setDefaultTemplate(id).onFailure {
                // Roll back so the UI never shows a default the server did not store
                _state.update { s -> s.copy(selected = previous, error = true) }
            }
        }
    }
}

/** Settings section: choose the summary template used for new recordings. Renders nothing until templates load. */
@Composable
fun DefaultSummaryTemplateSection(viewModel: DefaultTemplateViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    if (state.templates.isEmpty()) return

    Column(modifier = Modifier.padding(vertical = 8.dp)) {
        MmSectionHeader(
            title = stringResource(R.string.settings_default_template),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
        )
        MmCard(modifier = Modifier.padding(horizontal = 16.dp)) {
            Column(Modifier.selectableGroup()) {
                state.templates.forEach { t ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = state.selected == t.id,
                                onClick = { viewModel.select(t.id) },
                                role = Role.RadioButton
                            )
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        RadioButton(selected = state.selected == t.id, onClick = null)
                        Spacer(Modifier.width(16.dp))
                        Column {
                            Text(t.name, style = MaterialTheme.typography.bodyLarge)
                            if (t.description.isNotBlank()) {
                                Text(
                                    t.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
                Text(
                    text = stringResource(R.string.settings_default_template_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
            }
        }
    }
}
