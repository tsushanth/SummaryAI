package com.kreativekoala.summaryai.data.api.models

/** PUT /api/voice-assistant */
data class VoiceAssistantRequest(val enabled: Boolean)

/**
 * GET / PUT /api/voice-assistant: the caller's effective state.
 * [preference] is the user's own saved choice (null = never set); [reason] is why [enabled] is what it is
 * (enabled, user_opted_out, killed, mode_off, not_opted_in); [mode] is the server rollout mode (off, opt_in, all).
 */
data class VoiceAssistantResponse(
    val enabled: Boolean? = null,
    val reason: String? = null,
    val preference: Boolean? = null,
    val mode: String? = null
)
