package com.kreativekoala.summaryai.ui.recordings.share

import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import androidx.core.content.FileProvider
import com.kreativekoala.summaryai.domain.model.Recording
import com.kreativekoala.summaryai.domain.model.Summary
import com.kreativekoala.summaryai.domain.model.Transcript
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream

/**
 * Builds shareable artifacts (text, PDF, downloaded audio) for a recording and
 * hands them off to the OS share sheet via [Intent.ACTION_SEND]. Mirrors the
 * iOS ShareExportView behaviour so the two platforms produce equivalent output.
 */
object ShareExporter {

    private const val FILE_PROVIDER_SUFFIX = ".fileprovider"
    private const val SHARED_DIR = "shared"

    enum class ExportType {
        SUMMARY_PDF, SUMMARY_TEXT,
        TRANSCRIPT_PDF, TRANSCRIPT_TEXT,
        LIVE_TRANSCRIPT_PDF, LIVE_TRANSCRIPT_TEXT,
        AUDIO,
    }

    suspend fun share(
        context: Context,
        type: ExportType,
        recording: Recording,
        summary: Summary?,
        transcript: Transcript?,
        liveTranscript: com.kreativekoala.summaryai.data.api.models.StitchedLiveTranscriptResponse? = null,
    ): Result<Unit> = runCatching {
        when (type) {
            ExportType.SUMMARY_TEXT -> {
                val text = summary?.let { summaryMarkdown(recording, it, transcript?.speakerNames) }
                    ?: throw IllegalStateException("Summary not ready yet.")
                shareText(context, text)
            }
            ExportType.SUMMARY_PDF -> {
                val text = summary?.let { summaryMarkdown(recording, it, transcript?.speakerNames) }
                    ?: throw IllegalStateException("Summary not ready yet.")
                val file = writePdf(context, "${safeTitle(recording.title)} - Summary", text)
                shareFile(context, file, "application/pdf")
            }
            ExportType.TRANSCRIPT_TEXT -> {
                val text = transcript?.let { transcriptMarkdown(recording, it) }
                    ?: throw IllegalStateException("Transcript not ready yet.")
                shareText(context, text)
            }
            ExportType.TRANSCRIPT_PDF -> {
                val text = transcript?.let { transcriptMarkdown(recording, it) }
                    ?: throw IllegalStateException("Transcript not ready yet.")
                val file = writePdf(context, "${safeTitle(recording.title)} - Transcript", text)
                shareFile(context, file, "application/pdf")
            }
            ExportType.LIVE_TRANSCRIPT_TEXT -> {
                val text = liveTranscript?.let { liveTranscriptMarkdown(recording, it) }
                    ?: throw IllegalStateException("No live transcript captured yet.")
                shareText(context, text)
            }
            ExportType.LIVE_TRANSCRIPT_PDF -> {
                val text = liveTranscript?.let { liveTranscriptMarkdown(recording, it) }
                    ?: throw IllegalStateException("No live transcript captured yet.")
                val file = writePdf(context, "${safeTitle(recording.title)} - Live Transcript", text)
                shareFile(context, file, "application/pdf")
            }
            ExportType.AUDIO -> {
                val url = recording.audioUrl
                    ?: throw IllegalStateException("No audio available for this recording.")
                val file = downloadAudio(context, recording.title, url)
                shareFile(context, file, "audio/*")
            }
        }
    }

    private fun liveTranscriptMarkdown(
        recording: Recording,
        stitched: com.kreativekoala.summaryai.data.api.models.StitchedLiveTranscriptResponse,
    ): String = buildString {
        appendLine("# ${recording.title} - Live Transcript").appendLine()
        appendLine("_Captured live during the meeting. ${stitched.wordCount} words, ${stitched.speakerCount} speakers._").appendLine()
        stitched.segments.forEach { seg ->
            val mins = (seg.startTime / 60).toInt()
            val secs = (seg.startTime % 60).toInt()
            val ts = String.format("%02d:%02d", mins, secs)
            appendLine("[$ts] ${seg.speakerLabel}: ${seg.text}").appendLine()
        }
    }

    // ----- Content generators (markdown-compatible plain text) -----

    private fun summaryMarkdown(recording: Recording, summary: Summary, names: Map<String, String>?): String = buildString {
        appendLine("# ${recording.title}").appendLine()
        appendLine("## Summary").appendLine(summary.shortSummary.applyingSpeakerNames(names))
        summary.detailedSummary?.takeIf { it.isNotBlank() }?.let {
            appendLine().appendLine(it.applyingSpeakerNames(names))
        }
        if (summary.hasKeyPoints) {
            appendLine().appendLine("## Key Points")
            summary.keyPoints.forEach { appendLine("• ${it.applyingSpeakerNames(names)}") }
        }
        if (summary.hasActionItems) {
            appendLine().appendLine("## Action Items")
            summary.actionItems.forEach { appendLine("• ${it.applyingSpeakerNames(names)}") }
        }
        if (summary.hasTopics) {
            appendLine().appendLine("## Topics")
            appendLine(summary.topics.joinToString(", "))
        }
    }

    private fun transcriptMarkdown(recording: Recording, transcript: Transcript): String = buildString {
        val names = transcript.speakerNames
        appendLine("# ${recording.title} - Transcript").appendLine()
        transcript.segments.forEach { seg ->
            val speaker = (seg.speaker ?: "Speaker").applyingSpeakerNames(names)
            appendLine("[${seg.formattedStartTime}] $speaker: ${seg.text.applyingSpeakerNames(names)}").appendLine()
        }
    }

    // ----- PDF rendering with pagination -----

    private fun writePdf(context: Context, title: String, body: String): File {
        val document = PdfDocument()
        val pageWidth = 612
        val pageHeight = 792
        val margin = 50
        val pageHeaderPaint = Paint().apply {
            color = 0xFF000000.toInt(); textSize = 22f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); isAntiAlias = true
        }
        val h1Paint = Paint().apply {
            color = 0xFF000000.toInt(); textSize = 20f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); isAntiAlias = true
        }
        val h2Paint = Paint().apply {
            color = 0xFF000000.toInt(); textSize = 16f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); isAntiAlias = true
        }
        val h3Paint = Paint().apply {
            color = 0xFF000000.toInt(); textSize = 13f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); isAntiAlias = true
        }
        val bodyPaint = Paint().apply {
            color = 0xFF000000.toInt(); textSize = 12f
            typeface = Typeface.DEFAULT; isAntiAlias = true
        }

        val contentTop = (margin + 22 + 18).toFloat()
        val contentBottom = (pageHeight - margin).toFloat()
        val maxWidth = (pageWidth - 2 * margin).toFloat()

        // Typed lines (each visual line carries its own paint + top gap).
        data class TypedLine(val text: String, val paint: Paint, val topGap: Float)
        val lines = mutableListOf<TypedLine>()
        var skippedFirstH1 = false
        for (raw in body.split('\n')) {
            val trimmed = raw.trim()
            val paint: Paint
            val stripped: String
            var topGap = 0f
            when {
                trimmed.startsWith("### ") -> { paint = h3Paint; stripped = trimmed.removePrefix("### "); topGap = 6f }
                trimmed.startsWith("## ")  -> { paint = h2Paint; stripped = trimmed.removePrefix("## ");  topGap = 10f }
                trimmed.startsWith("# ")   -> {
                    if (!skippedFirstH1) { skippedFirstH1 = true; continue }
                    paint = h1Paint; stripped = trimmed.removePrefix("# "); topGap = 12f
                }
                else -> { paint = bodyPaint; stripped = raw }
            }
            val wrapped = wrapToLines(stripped, paint, maxWidth)
            wrapped.forEachIndexed { idx, w ->
                lines.add(TypedLine(w, paint, if (idx == 0) topGap else 0f))
            }
            if (stripped.isEmpty() && trimmed.isEmpty()) {
                lines.add(TypedLine("", bodyPaint, 0f))
            }
        }

        var pageNumber = 1
        var lineIndex = 0
        while (lineIndex < lines.size) {
            val info = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create()
            val page = document.startPage(info)
            val canvas = page.canvas
            val header = if (pageNumber == 1) title else "$title (cont.)"
            canvas.drawText(header, margin.toFloat(), (margin + 22).toFloat(), pageHeaderPaint)

            var y = contentTop
            while (lineIndex < lines.size) {
                val line = lines[lineIndex]
                val lh = line.paint.fontSpacing
                val needed = line.topGap + lh
                if (y + needed > contentBottom) break
                y += line.topGap + lh // advance to baseline for this line
                if (line.text.isNotEmpty()) {
                    canvas.drawText(line.text, margin.toFloat(), y, line.paint)
                }
                lineIndex++
            }
            document.finishPage(page)
            pageNumber++
        }

        val outFile = sharedFile(context, "${safeTitle(title)}.pdf")
        FileOutputStream(outFile).use { document.writeTo(it) }
        document.close()
        return outFile
    }

    private fun wrapToLines(text: String, paint: Paint, maxWidth: Float): List<String> {
        if (text.isEmpty()) return listOf("")
        val out = mutableListOf<String>()
        val words = text.split(' ')
        var current = StringBuilder()
        for (word in words) {
            val candidate = if (current.isEmpty()) word else "$current $word"
            if (paint.measureText(candidate) <= maxWidth) {
                current = StringBuilder(candidate)
            } else {
                if (current.isNotEmpty()) out.add(current.toString())
                if (paint.measureText(word) > maxWidth) {
                    var chunk = StringBuilder()
                    for (ch in word) {
                        if (paint.measureText("$chunk$ch") > maxWidth) {
                            if (chunk.isNotEmpty()) out.add(chunk.toString())
                            chunk = StringBuilder("$ch")
                        } else chunk.append(ch)
                    }
                    current = chunk
                } else current = StringBuilder(word)
            }
        }
        if (current.isNotEmpty()) out.add(current.toString())
        return if (out.isEmpty()) listOf("") else out
    }

    // ----- Audio download -----

    private suspend fun downloadAudio(context: Context, title: String, url: String): File =
        withContext(Dispatchers.IO) {
            val client = OkHttpClient()
            val response = client.newCall(Request.Builder().url(url).build()).execute()
            if (!response.isSuccessful) throw IllegalStateException("Audio download failed (${response.code}).")

            // Pick extension carefully: signed URLs end with a JWT (...?token=eyJ.payload.sig)
            // where the last `.` is in the token, not the filename. Strip the query first.
            val ext = audioExtensionFor(url, response.header("Content-Type"))
            val outFile = sharedFile(context, "${safeTitle(title)}.$ext")
            response.body?.byteStream()?.use { input ->
                FileOutputStream(outFile).use { output -> input.copyTo(output) }
            } ?: throw IllegalStateException("Empty audio response.")
            outFile
        }

    private fun audioExtensionFor(url: String, contentType: String?): String {
        // 1. Try the URL path (strip query first).
        val path = url.substringBefore('?')
        val pathExt = path.substringAfterLast('.', "").lowercase()
        if (pathExt.matches(Regex("^[a-z0-9]{2,5}$"))) {
            // Looks like a real extension.
            return pathExt
        }
        // 2. Fall back to Content-Type → extension.
        return when (contentType?.substringBefore(';')?.trim()?.lowercase()) {
            "audio/mp4", "audio/m4a", "audio/x-m4a" -> "m4a"
            "audio/mpeg", "audio/mp3" -> "mp3"
            "audio/wav", "audio/x-wav" -> "wav"
            "audio/ogg" -> "ogg"
            "audio/aac" -> "aac"
            "audio/webm" -> "webm"
            "audio/flac" -> "flac"
            else -> "m4a"
        }
    }

    // ----- Share sheet plumbing -----

    private fun shareText(context: Context, text: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        context.startActivity(Intent.createChooser(intent, "Share").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun shareFile(context: Context, file: File, mime: String) {
        val authority = context.packageName + FILE_PROVIDER_SUFFIX
        val uri: Uri = FileProvider.getUriForFile(context, authority, file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "Share").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun sharedFile(context: Context, name: String): File {
        val dir = File(context.cacheDir, SHARED_DIR).apply { if (!exists()) mkdirs() }
        return File(dir, name)
    }

    private fun safeTitle(title: String): String =
        title.replace(Regex("[\\\\/:*?\"<>|]"), "-").trim().ifBlank { "Recording" }
}
