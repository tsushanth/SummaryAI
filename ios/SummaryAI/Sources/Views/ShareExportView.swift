import SwiftUI

// MARK: - Share Export View

/// Bottom sheet for sharing/exporting recording content
struct ShareExportView: View {
    let recording: Recording
    let summary: RecordingSummary?
    let transcript: Transcript?
    let audioURL: URL?
    let onDismiss: () -> Void

    @EnvironmentObject var apiClient: SummaryAIAPIClient
    @State private var isGenerating = false
    @State private var errorMessage: String?

    /// True when this recording came from a meeting bot — exposes "live transcript"
    /// share options that pull from the realtime stream (works even when the
    /// post-processed transcript isn't ready yet).
    private var hasMeetingId: Bool { (recording.meetingId ?? "").isEmpty == false }

    private var exportOptions: [ShareExportOption] {
        var opts: [ShareExportOption] = [
            ShareExportOption(icon: "doc.fill", title: "Share Summary as PDF", type: .summaryPDF),
            ShareExportOption(icon: "doc.text.fill", title: "Share Summary as Text", type: .summaryText),
            ShareExportOption(icon: "doc.fill", title: "Share Transcript as PDF", type: .transcriptPDF),
            ShareExportOption(icon: "doc.text.fill", title: "Share Transcript as Text", type: .transcriptText),
        ]
        if hasMeetingId {
            opts.append(ShareExportOption(icon: "waveform.path", title: "Share Live Transcript (Text)", type: .liveTranscriptText))
            opts.append(ShareExportOption(icon: "doc.fill", title: "Share Live Transcript (PDF)", type: .liveTranscriptPDF))
        }
        opts.append(ShareExportOption(icon: "waveform", title: "Share Audio", type: .audio))
        return opts
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Share or Export")
                    .font(.headline)

                Spacer()

                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.title2)
                        .foregroundColor(.secondary)
                }
            }
            .padding()

            Divider()

            // Export options
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(exportOptions) { option in
                        ShareExportOptionRow(option: option) {
                            handleExport(option.type)
                        }
                        .disabled(!isOptionEnabled(option.type))
                        .opacity(isOptionEnabled(option.type) ? 1 : 0.5)
                    }
                }
                .padding()
            }

            // Tip
            HStack(spacing: 8) {
                Image(systemName: "lightbulb.fill")
                    .foregroundColor(.yellow)

                Text("Share or export with just a tap!")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding()
        }
        .overlay {
            if isGenerating {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()

                VStack(spacing: 16) {
                    ProgressView()
                        .scaleEffect(1.5)
                        .tint(.white)

                    Text("Generating...")
                        .foregroundColor(.white)
                }
            }
        }
        .alert("Couldn't share", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func isOptionEnabled(_ type: ExportType) -> Bool {
        switch type {
        case .summaryPDF, .summaryText:
            return summary != nil
        case .transcriptPDF, .transcriptText:
            return transcript != nil
        case .liveTranscriptPDF, .liveTranscriptText:
            return hasMeetingId
        case .audio:
            return true // Audio is always available if recording exists
        }
    }

    private func handleExport(_ type: ExportType) {
        isGenerating = true

        Task {
            defer {
                Task { @MainActor in
                    isGenerating = false
                }
            }

            var content: String = ""

            switch type {
            case .summaryPDF:
                content = generateSummaryContent()
                await sharePDF(content: content, title: "\(recording.title) - Summary")

            case .summaryText:
                content = generateSummaryContent()
                await shareText(content: content)

            case .transcriptPDF:
                content = generateTranscriptContent()
                await sharePDF(content: content, title: "\(recording.title) - Transcript")

            case .transcriptText:
                content = generateTranscriptContent()
                await shareText(content: content)

            case .liveTranscriptPDF:
                content = await generateLiveTranscriptContent()
                if content.isEmpty {
                    Task { @MainActor in errorMessage = "No live transcript captured yet." }
                } else {
                    await sharePDF(content: content, title: "\(recording.title) - Live Transcript")
                }

            case .liveTranscriptText:
                content = await generateLiveTranscriptContent()
                if content.isEmpty {
                    Task { @MainActor in errorMessage = "No live transcript captured yet." }
                } else {
                    await shareText(content: content)
                }

            case .audio:
                await shareAudio()
            }
        }
    }

    @MainActor
    private func shareAudio() async {
        guard let audioURL else {
            errorMessage = "No audio available for this recording."
            return
        }

        // Local file (file://) — share directly.
        if audioURL.isFileURL {
            present(activityItems: [audioURL])
            return
        }

        // Remote URL — download to a temp file with a friendly name so the
        // recipient gets an actual audio file, not a soon-to-expire link.
        do {
            let (data, response) = try await URLSession.shared.data(from: audioURL)
            let ext = (response.suggestedFilename as NSString?)?.pathExtension.nilIfEmpty
                ?? audioURL.pathExtension.nilIfEmpty
                ?? "m4a"
            let safeTitle = recording.title.replacingOccurrences(of: "/", with: "-")
            let tempURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(safeTitle).\(ext)")
            try data.write(to: tempURL, options: .atomic)
            present(activityItems: [tempURL])
        } catch {
            errorMessage = "Couldn't prepare audio for sharing: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func present(activityItems: [Any]) {
        let activityVC = UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
        guard let rootVC = Self.topPresentedViewController() else {
            errorMessage = "Couldn't open the share sheet. Please try again."
            return
        }
        rootVC.present(activityVC, animated: true)
    }

    private static func topPresentedViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.first as? UIWindowScene
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController
            ?? scene?.windows.first?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    private func generateSummaryContent() -> String {
        guard let summary = summary else { return "" }
        let names = transcript?.speakerNames

        var content = """
        # \(recording.title)

        ## Summary
        \(summary.summary.applyingSpeakerNames(names))

        """

        if !summary.keyPoints.isEmpty {
            content += "\n## Key Points\n"
            for point in summary.keyPoints {
                content += "• \(point.applyingSpeakerNames(names))\n"
            }
        }

        if let actionItems = summary.actionItems, !actionItems.isEmpty {
            content += "\n## Action Items\n"
            for item in actionItems {
                content += "• \(item.task.applyingSpeakerNames(names))"
                if let assignee = item.assignee {
                    content += " (Assigned to: \(assignee.applyingSpeakerNames(names)))"
                }
                content += "\n"
            }
        }

        if let topics = summary.topics, !topics.isEmpty {
            content += "\n## Topics\n"
            content += topics.joined(separator: ", ")
        }

        return content
    }

    private func generateTranscriptContent() -> String {
        guard let transcript = transcript else { return "" }
        let names = transcript.speakerNames

        var content = "# \(recording.title) - Transcript\n\n"

        for segment in transcript.segments {
            let timestamp = formatTimestamp(segment.startTime)
            let rawSpeaker = segment.speaker ?? "Speaker"
            let speaker = rawSpeaker.applyingSpeakerNames(names)
            content += "[\(timestamp)] \(speaker): \(segment.text.applyingSpeakerNames(names))\n\n"
        }

        return content
    }

    /// Fetch the realtime-stitched live transcript and format it for share.
    /// Returns "" if nothing has been captured yet, which the caller surfaces
    /// as an inline error rather than sharing an empty document.
    private func generateLiveTranscriptContent() async -> String {
        guard let meetingId = recording.meetingId, !meetingId.isEmpty else { return "" }
        let stitched: StitchedLiveTranscript
        do {
            stitched = try await apiClient.getStitchedLiveTranscript(meetingId: meetingId)
        } catch {
            await MainActor.run { errorMessage = "Couldn't fetch live transcript: \(error.localizedDescription)" }
            return ""
        }
        if stitched.segments.isEmpty { return "" }
        var content = "# \(recording.title) - Live Transcript\n\n"
        content += "_Captured live during the meeting. \(stitched.wordCount) words, \(stitched.speakerCount) speakers._\n\n"
        for segment in stitched.segments {
            let timestamp = formatTimestamp(segment.startTime)
            let speaker = segment.speaker ?? "Speaker"
            content += "[\(timestamp)] \(speaker): \(segment.text)\n\n"
        }
        return content
    }

    private func formatTimestamp(_ seconds: Double) -> String {
        let minutes = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%02d:%02d", minutes, secs)
    }

    @MainActor
    private func shareText(content: String) async {
        present(activityItems: [content])
    }

    @MainActor
    private func sharePDF(content: String, title: String) async {
        let pdfData = generatePDF(from: content, title: title)
        let safeTitle = title.replacingOccurrences(of: "/", with: "-")
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(safeTitle).pdf")
        do {
            try pdfData.write(to: tempURL, options: .atomic)
            present(activityItems: [tempURL])
        } catch {
            errorMessage = "Couldn't write PDF: \(error.localizedDescription)"
        }
    }

    private func generatePDF(from content: String, title: String) -> Data {
        let pageWidth: CGFloat = 612
        let pageHeight: CGFloat = 792
        let margin: CGFloat = 50
        let pageHeaderHeight: CGFloat = 36
        let pageHeaderGap: CGFloat = 18
        let contentTop = margin + pageHeaderHeight + pageHeaderGap
        let contentBottom = pageHeight - margin
        let maxWidth = pageWidth - 2 * margin

        let pdfMetaData: [CFString: Any] = [
            kCGPDFContextCreator: "Meeting Mind",
            kCGPDFContextAuthor: "Meeting Mind",
            kCGPDFContextTitle: title
        ]
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = pdfMetaData as [String: Any]

        let pageRect = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
        let renderer = UIGraphicsPDFRenderer(bounds: pageRect, format: format)

        let pageHeaderAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: 22),
            .foregroundColor: UIColor.black
        ]
        let h1Attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: 20),
            .foregroundColor: UIColor.black
        ]
        let h2Attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: 16),
            .foregroundColor: UIColor.black
        ]
        let h3Attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.boldSystemFont(ofSize: 13),
            .foregroundColor: UIColor.black
        ]
        let bodyAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 12),
            .foregroundColor: UIColor.black
        ]

        // Build a list of typed lines (markdown -> (text, attrs, leading-gap))
        // and skip the first `# title` line since the PDF page header already
        // carries the title.
        struct Line { let text: String; let attrs: [NSAttributedString.Key: Any]; let topGap: CGFloat; let lineHeight: CGFloat }
        var lines: [Line] = []
        let rawLines = content.split(separator: "\n", omittingEmptySubsequences: false)
        var skippedFirstH1 = false
        for raw in rawLines {
            let s = String(raw)
            let trimmed = s.trimmingCharacters(in: .whitespaces)
            let attrs: [NSAttributedString.Key: Any]
            let stripped: String
            var topGap: CGFloat = 0
            if trimmed.hasPrefix("### ") {
                attrs = h3Attrs; stripped = String(trimmed.dropFirst(4)); topGap = 6
            } else if trimmed.hasPrefix("## ") {
                attrs = h2Attrs; stripped = String(trimmed.dropFirst(3)); topGap = 10
            } else if trimmed.hasPrefix("# ") {
                if !skippedFirstH1 { skippedFirstH1 = true; continue }
                attrs = h1Attrs; stripped = String(trimmed.dropFirst(2)); topGap = 12
            } else {
                attrs = bodyAttrs; stripped = s
            }
            // Word-wrap stripped text to maxWidth.
            let wrapped = Self.wrap(stripped, attrs: attrs, maxWidth: maxWidth)
            let lh = (attrs[.font] as? UIFont)?.lineHeight ?? 16
            for (idx, w) in wrapped.enumerated() {
                lines.append(Line(text: w, attrs: attrs, topGap: idx == 0 ? topGap : 0, lineHeight: lh))
            }
            // Blank line spacing for empty input lines.
            if stripped.isEmpty && trimmed.isEmpty {
                lines.append(Line(text: "", attrs: bodyAttrs, topGap: 0, lineHeight: 8))
            }
        }

        return renderer.pdfData { context in
            var y: CGFloat = contentTop
            var pageNumber = 1

            func beginPage() {
                context.beginPage()
                let headerText = pageNumber == 1 ? title : "\(title) (cont.)"
                let headerRect = CGRect(x: margin, y: margin, width: maxWidth, height: pageHeaderHeight)
                headerText.draw(in: headerRect, withAttributes: pageHeaderAttrs)
                y = contentTop
            }

            beginPage()
            for line in lines {
                let needed = line.topGap + line.lineHeight
                if y + needed > contentBottom {
                    pageNumber += 1
                    beginPage()
                }
                y += line.topGap
                if !line.text.isEmpty {
                    line.text.draw(at: CGPoint(x: margin, y: y), withAttributes: line.attrs)
                }
                y += line.lineHeight
            }
        }
    }

    private static func wrap(_ text: String, attrs: [NSAttributedString.Key: Any], maxWidth: CGFloat) -> [String] {
        if text.isEmpty { return [""] }
        let font = (attrs[.font] as? UIFont) ?? UIFont.systemFont(ofSize: 12)
        let measure: (String) -> CGFloat = { (NSAttributedString(string: $0, attributes: [.font: font])).size().width }
        var out: [String] = []
        let words = text.split(separator: " ", omittingEmptySubsequences: false)
        var current = ""
        for w in words {
            let word = String(w)
            let candidate = current.isEmpty ? word : "\(current) \(word)"
            if measure(candidate) <= maxWidth {
                current = candidate
            } else {
                if !current.isEmpty { out.append(current) }
                // Word itself longer than line — hard break by character.
                if measure(word) > maxWidth {
                    var chunk = ""
                    for ch in word {
                        if measure(chunk + String(ch)) > maxWidth {
                            if !chunk.isEmpty { out.append(chunk) }
                            chunk = String(ch)
                        } else { chunk.append(ch) }
                    }
                    current = chunk
                } else { current = word }
            }
        }
        if !current.isEmpty { out.append(current) }
        return out.isEmpty ? [""] : out
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

// MARK: - Export Type

enum ExportType {
    case summaryPDF
    case summaryText
    case transcriptPDF
    case transcriptText
    case liveTranscriptPDF
    case liveTranscriptText
    case audio
}

// MARK: - Share Export Option

struct ShareExportOption: Identifiable {
    let id = UUID()
    let icon: String
    let title: String
    let type: ExportType
}

// MARK: - Share Export Option Row

struct ShareExportOptionRow: View {
    let option: ShareExportOption
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                ZStack {
                    Circle()
                        .fill(Color.gray.opacity(0.1))
                        .frame(width: 44, height: 44)

                    Image(systemName: option.icon)
                        .font(.system(size: 18))
                        .foregroundColor(.primary)
                }

                Text(option.title)
                    .font(.body)
                    .foregroundColor(.primary)

                Spacer()
            }
            .padding()
            .background(Color(.secondarySystemBackground))
            .cornerRadius(12)
        }
    }
}

// MARK: - Quick Share Button

/// Quick share button for the recording detail toolbar
struct QuickShareButton: View {
    let recording: Recording
    let summary: RecordingSummary?
    let transcript: Transcript?
    let audioURL: URL?

    @State private var showShareSheet = false

    var body: some View {
        Button {
            showShareSheet = true
        } label: {
            Image(systemName: "square.and.arrow.up")
        }
        .sheet(isPresented: $showShareSheet) {
            ShareExportView(
                recording: recording,
                summary: summary,
                transcript: transcript,
                audioURL: audioURL
            ) {
                showShareSheet = false
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

// MARK: - Preview

#if DEBUG
struct ShareExportView_Previews: PreviewProvider {
    static var previews: some View {
        ShareExportView(
            recording: Recording(
                id: "1",
                userId: "user1",
                title: "Team Meeting",
                durationSeconds: 3600,
                fileSizeBytes: nil,
                filePath: nil,
                status: .completed,
                errorMessage: nil,
                speakerCount: 3,
                wordCount: 1500,
                language: "en",
                tags: nil,
                isFavorite: false,
                folderId: nil,
                recordingType: .meeting,
                createdAt: Date(),
                updatedAt: nil,
                processedAt: nil
            ),
            summary: nil,
            transcript: nil,
            audioURL: nil
        ) {}
    }
}
#endif
