package com.kreativekoala.summaryai.ui.recordings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kreativekoala.summaryai.R
import com.kreativekoala.summaryai.ui.components.MmCard
import com.kreativekoala.summaryai.ui.components.MmSectionHeader

@Composable
internal fun ChatTab(
    qaMessages: List<QAMessage>,
    currentQuestion: String,
    isAskingQuestion: Boolean,
    onQuestionChange: (String) -> Unit,
    onAskQuestion: () -> Unit,
    onSuggestedQuestion: (String) -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                MmCard {
                    Text(
                        text = stringResource(R.string.chat_welcome_message),
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            item {
                SuggestedQuestionsSection(onSuggestedQuestion = onSuggestedQuestion)
            }

            if (qaMessages.isNotEmpty()) {
                item { HorizontalDivider() }
                items(qaMessages) { message ->
                    ChatMessageItem(message = message)
                }
            }
        }

        ChatInputBar(
            currentQuestion = currentQuestion,
            isAskingQuestion = isAskingQuestion,
            onQuestionChange = onQuestionChange,
            onAskQuestion = onAskQuestion
        )
    }
}

@Composable
private fun SuggestedQuestionsSection(onSuggestedQuestion: (String) -> Unit) {
    val keyPointsFull = stringResource(R.string.suggested_question_key_points_full)
    val actionItemsFull = stringResource(R.string.suggested_question_action_items_full)
    val followupEmailFull = stringResource(R.string.suggested_question_followup_email_full)

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SuggestedQuestionCard(
            text = stringResource(R.string.suggested_question_key_points),
            onClick = { onSuggestedQuestion(keyPointsFull) }
        )
        SuggestedQuestionCard(
            text = stringResource(R.string.suggested_question_action_items),
            onClick = { onSuggestedQuestion(actionItemsFull) }
        )
        SuggestedQuestionCard(
            text = stringResource(R.string.suggested_question_followup_email),
            onClick = { onSuggestedQuestion(followupEmailFull) }
        )
    }
}

@Composable
private fun SuggestedQuestionCard(text: String, onClick: () -> Unit) {
    MmCard(onClick = onClick) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f)
            )
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ChatMessageItem(message: QAMessage) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        // Question: right-leaning primary bubble
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
            color = MaterialTheme.colorScheme.primaryContainer
        ) {
            Column(Modifier.padding(12.dp)) {
                Text(
                    text = stringResource(R.string.chat_sender_you),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = message.question,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        // Answer
        MmCard {
            Column(Modifier.padding(12.dp)) {
                MmSectionHeader(
                    title = stringResource(R.string.chat_sender_ai),
                    icon = Icons.Default.AutoAwesome
                )
                Spacer(modifier = Modifier.height(4.dp))
                if (message.isLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    Text(
                        text = message.answer ?: stringResource(R.string.no_answer),
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatInputBar(
    currentQuestion: String,
    isAskingQuestion: Boolean,
    onQuestionChange: (String) -> Unit,
    onAskQuestion: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = MaterialTheme.colorScheme.surfaceContainer
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = currentQuestion,
                onValueChange = onQuestionChange,
                modifier = Modifier.weight(1f),
                placeholder = { Text(stringResource(R.string.chat_placeholder)) },
                shape = MaterialTheme.shapes.large,
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh
                )
            )

            Spacer(modifier = Modifier.width(12.dp))

            FilledIconButton(
                onClick = onAskQuestion,
                enabled = currentQuestion.isNotBlank() && !isAskingQuestion,
                modifier = Modifier.size(48.dp)
            ) {
                if (isAskingQuestion) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = MaterialTheme.colorScheme.onPrimary,
                        strokeWidth = 2.dp
                    )
                } else if (currentQuestion.isEmpty()) {
                    Icon(Icons.Default.Mic, contentDescription = stringResource(R.string.voice_input))
                } else {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.send))
                }
            }
        }
    }
}
