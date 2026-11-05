package com.kreativekoala.summaryai.service.voice

import javax.inject.Inject
import javax.inject.Named
import javax.inject.Singleton

/**
 * Decides whether the hands-free entry points are shown. Two switches must both be on:
 *  1. the build flag (BuildConfig.VOICE_ACTIONS_ENABLED, false unless the build is made with -PvoiceActions=true), and
 *  2. the server, which answers 404 to the availability probe while the feature is off for the account.
 * Any failure means "off": a flaky network never shows a button that then fails. The answer is cached for [ttlMs].
 */
@Singleton
class VoiceFeatureGate @Inject constructor(
    private val client: VoiceToolsClient,
    @Named("voiceBuildEnabled") private val buildEnabled: Boolean,
) {
    private var cached: Boolean? = null
    private var cachedAt = 0L
    var clock: () -> Long = System::currentTimeMillis
    var timeZone: () -> String = { java.util.TimeZone.getDefault().id }

    suspend fun isAvailable(): Boolean {
        if (!buildEnabled) return false
        val now = clock()
        cached?.let { if (now - cachedAt < TTL_MS) return it }
        val ok = try {
            client.date(timeZone())
            true
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }
        cached = ok
        cachedAt = now
        return ok
    }

    companion object {
        const val TTL_MS = 10 * 60 * 1000L
    }
}
