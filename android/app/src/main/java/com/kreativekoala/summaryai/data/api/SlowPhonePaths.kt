package com.kreativekoala.summaryai.data.api

import okhttp3.Interceptor
import okhttp3.Response
import java.util.concurrent.TimeUnit

/** Setting up a phone agent takes the server up to a minute and a half; only that request waits longer. */
class SlowPhonePaths : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val slow = request.method == "PUT" && request.url.encodedPath == "/api/phone/agent"
        return if (slow) chain.withReadTimeout(AGENT_SECONDS, TimeUnit.SECONDS).proceed(request) else chain.proceed(request)
    }

    private companion object { const val AGENT_SECONDS = 100 }
}
