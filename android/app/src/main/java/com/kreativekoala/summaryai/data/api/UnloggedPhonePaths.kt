package com.kreativekoala.summaryai.data.api

import okhttp3.Interceptor
import okhttp3.Response

/** Applies [logging] to everything except the phone routes, whose bodies carry phone numbers, codes and call tokens. */
class UnloggedPhonePaths(private val logging: Interceptor) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response =
        if (chain.request().url.encodedPath.startsWith("/api/phone")) chain.proceed(chain.request())
        else logging.intercept(chain)
}
