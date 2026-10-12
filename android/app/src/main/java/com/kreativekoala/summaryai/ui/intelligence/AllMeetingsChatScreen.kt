package com.kreativekoala.summaryai.ui.intelligence

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.data.api.models.ChatCitationDto
import com.kreativekoala.summaryai.data.repository.IntelligenceRepository
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmEmptyState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AllChatMessage(
    val id: Int,
    val question: String,
    val answer: String? = null,
    val citations: List<ChatCitationDto> = emptyList(),
    val failed: Boolean = false
) {
    val isLoading: Boolean get() = answer == null && !failed
}

data class AllMeetingsChatState(
    val input: String = "",
    val messages: List<AllChatMessage> = emptyList()
) {
    val isAsking: Boolean get() = messages.any { it.isLoading }
}

@HiltViewModel
class AllMeetingsChatViewModel @Inject constructor(
    private val repository: IntelligenceRepository
) : ViewModel() {
    private val _state = MutableStateFlow(AllMeetingsChatState())
    val state: StateFlow<AllMeetingsChatState> = _state.asStateFlow()
    private var nextId = 0

    fun updateInput(text: String) = _state.update { it.copy(input = text) }

    fun ask() {
        val s = _state.value
        val q = s.input.trim()
        if (q.length < 3 || s.isAsking) return
        val id = nextId++
        _state.update { it.copy(input = "", messages = it.messages + AllChatMessage(id, q)) }
        viewModelScope.launch {
            repository.chat(q).fold(
                onSuccess = { r ->
                    update(id) { it.copy(answer = r.answer.ifBlank { "…" }, citations = r.citations) }
                },
                onFailure = { update(id) { it.copy(failed = true) } }
            )
        }
    }

    private fun update(id: Int, f: (AllChatMessage) -> AllChatMessage) {
        _state.update { s -> s.copy(messages = s.messages.map { if (it.id == id) f(it) else it }) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AllMeetingsChatScreen(
    viewModel: AllMeetingsChatViewModel = hiltViewModel(),
    onRecordingClick: (String) -> Unit,
    onNavigateBack: () -> Unit
) {
    val state by viewModel.state.collectAsState()
    val listState = rememberLazyListState()
    LaunchedEffect(state.messages.size) {
        if (state.messages.isNotEmpty()) listState.animateScrollToItem(state.messages.lastIndex)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.chat_all_meetings_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                }
            )
        },
        bottomBar = {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = state.input,
                    onValueChange = viewModel::updateInput,
                    placeholder = { Text(stringResource(R.string.chat_all_meetings_placeholder)) },
                    modifier = Modifier.weight(1f),
                    maxLines = 3,
                    shape = MaterialTheme.shapes.large
                )
                IconButton(
                    onClick = viewModel::ask,
                    enabled = state.input.trim().length >= 3 && !state.isAsking
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.chat_all_meetings_send)
                    )
                }
            }
        }
    ) { padding ->
        if (state.messages.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                MmEmptyState(
                    icon = Icons.Default.AutoAwesome,
                    title = stringResource(R.string.chat_all_meetings_empty_title),
                    message = stringResource(R.string.chat_all_meetings_empty_message)
                )
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(state.messages, key = { it.id }) { m ->
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            m.question,
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary
                        )
                        MmCard {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                when {
                                    m.isLoading -> CircularProgressIndicator(
                                        Modifier.padding(4.dp),
                                        strokeWidth = 2.dp
                                    )
                                    m.failed -> Text(
                                        stringResource(R.string.chat_all_meetings_failed),
                                        color = MaterialTheme.colorScheme.error
                                    )
                                    else -> Text(m.answer.orEmpty(), style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                        if (m.citations.isNotEmpty()) {
                            Text(
                                stringResource(R.string.chat_all_meetings_sources),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            m.citations.forEach { c ->
                                MmCard(onClick = { onRecordingClick(c.recordingId) }) {
                                    Column(Modifier.padding(12.dp)) {
                                        Text(
                                            c.title.ifBlank { c.recordingId },
                                            style = MaterialTheme.typography.titleSmall,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        if (c.snippet.isNotBlank()) {
                                            Text(
                                                c.snippet,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                maxLines = 3,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
