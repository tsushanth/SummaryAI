package com.kreativekoala.summaryai.data.api.models

import com.google.gson.annotations.SerializedName

data class SummaryTemplateDto(
    val id: String,
    val name: String,
    val description: String = ""
)

data class SummaryTemplatesResponse(
    val templates: List<SummaryTemplateDto>,
    @SerializedName("default_template") val defaultTemplate: String? = null
)

data class SetDefaultTemplateRequest(val template: String)

data class DefaultTemplateResponse(
    @SerializedName("default_template") val defaultTemplate: String? = null
)

data class RegenerateSummaryRequest(val template: String)

/** Only the template is read; the recording is reloaded afterwards for the fresh summary. */
data class RegenerateSummaryResponse(val template: String? = null)

data class FollowUpEmailRequest(
    val tone: String? = null,
    val recipient: String? = null
)

data class FollowUpEmailResponse(
    val subject: String = "",
    val body: String = ""
)

data class ActionItemsToTodosResponse(
    val todos: List<TodoDto> = emptyList(),
    val skipped: Int = 0
)

data class CrossMeetingChatRequest(
    val question: String,
    @SerializedName("recording_ids") val recordingIds: List<String>? = null
)

data class ChatCitationDto(
    @SerializedName("recording_id") val recordingId: String,
    val title: String = "",
    val snippet: String = ""
)

data class CrossMeetingChatResponse(
    val answer: String = "",
    val citations: List<ChatCitationDto> = emptyList()
)
