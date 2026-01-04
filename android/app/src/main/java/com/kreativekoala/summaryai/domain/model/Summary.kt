package com.kreativekoala.summaryai.domain.model

/**
 * Summary domain model
 */
data class Summary(
    val id: String,
    val shortSummary: String,
    val detailedSummary: String?,
    val keyPoints: List<String>,
    val actionItems: List<String>,
    val topics: List<String>
) {
    val hasKeyPoints: Boolean
        get() = keyPoints.isNotEmpty()

    val hasActionItems: Boolean
        get() = actionItems.isNotEmpty()

    val hasTopics: Boolean
        get() = topics.isNotEmpty()
}
