package com.kreativekoala.summaryai.data.api

import okhttp3.MediaType
import okhttp3.RequestBody
import okio.Buffer
import okio.BufferedSink
import okio.ForwardingSink
import okio.Sink
import okio.buffer

/**
 * Wraps a RequestBody to report upload progress as bytes are written to the
 * network. Calls [onProgress] with a 0..1 fraction. Used for audio uploads so
 * the foreground-service notification can show a real percent instead of 0%.
 */
class ProgressRequestBody(
    private val delegate: RequestBody,
    private val onProgress: (Float) -> Unit
) : RequestBody() {

    override fun contentType(): MediaType? = delegate.contentType()
    override fun contentLength(): Long = delegate.contentLength()

    override fun writeTo(sink: BufferedSink) {
        val total = contentLength().takeIf { it > 0L } ?: -1L
        val counting = object : ForwardingSink(sink) {
            private var written = 0L
            override fun write(source: Buffer, byteCount: Long) {
                super.write(source, byteCount)
                written += byteCount
                if (total > 0L) {
                    onProgress((written.toFloat() / total.toFloat()).coerceIn(0f, 1f))
                }
            }
        }
        val bufferedSink: BufferedSink = (counting as Sink).buffer()
        delegate.writeTo(bufferedSink)
        bufferedSink.flush()
    }
}
