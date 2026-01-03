import SwiftUI

// MARK: - Share Export View

/// Bottom sheet for sharing/exporting recording content
struct ShareExportView: View {
    let recording: Recording
    let summary: RecordingSummary?
    let transcript: Transcript?
    let onDismiss: () -> Void

    @State private var isGenerating = false

    private let exportOptions: [ShareExportOption] = [
        ShareExportOption(
            icon: "doc.fill",
            title: "Share Summary as PDF",
            type: .summaryPDF
        ),
        ShareExportOption(
            icon: "doc.text.fill",
            title: "Share Summary as Text",
            type: .summaryText
        ),
        ShareExportOption(
            icon: "doc.fill",
            title: "Share Transcript as PDF",
            type: .transcriptPDF
        ),
        ShareExportOption(
            icon: "doc.text.fill",
            title: "Share Transcript as Text",
            type: .transcriptText
        ),
        ShareExportOption(
            icon: "waveform",
            title: "Share Audio",
            type: .audio
        )
    ]

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
    }

    private func isOptionEnabled(_ type: ExportType) -> Bool {
        switch type {
        case .summaryPDF, .summaryText:
            return summary != nil
        case .transcriptPDF, .transcriptText:
            return transcript != nil
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

            case .audio:
                // Share audio file URL
                break
            }
        }
    }

    private func generateSummaryContent() -> String {
        guard let summary = summary else { return "" }

        var content = """
        # \(recording.title)

        ## Summary
        \(summary.summary)

        """

        if !summary.keyPoints.isEmpty {
            content += "\n## Key Points\n"
            for point in summary.keyPoints {
                content += "• \(point)\n"
            }
        }

        if let actionItems = summary.actionItems, !actionItems.isEmpty {
            content += "\n## Action Items\n"
            for item in actionItems {
                content += "• \(item.task)"
                if let assignee = item.assignee {
                    content += " (Assigned to: \(assignee))"
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

        var content = "# \(recording.title) - Transcript\n\n"

        for segment in transcript.segments {
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
        let activityVC = UIActivityViewController(
            activityItems: [content],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }

    @MainActor
    private func sharePDF(content: String, title: String) async {
        // Generate PDF from content
        let pdfData = generatePDF(from: content, title: title)

        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(title).pdf")
        try? pdfData.write(to: tempURL)

        let activityVC = UIActivityViewController(
            activityItems: [tempURL],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let rootVC = windowScene.windows.first?.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }

    private func generatePDF(from content: String, title: String) -> Data {
        let pageWidth: CGFloat = 612
        let pageHeight: CGFloat = 792
        let margin: CGFloat = 50

        let pdfMetaData = [
            kCGPDFContextCreator: "Meeting Mind",
            kCGPDFContextAuthor: "Meeting Mind",
            kCGPDFContextTitle: title
        ]
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = pdfMetaData as [String: Any]

        let pageRect = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
        let renderer = UIGraphicsPDFRenderer(bounds: pageRect, format: format)

        let data = renderer.pdfData { context in
            context.beginPage()

            let titleAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 24)
            ]

            let bodyAttributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 12)
            ]

            let titleRect = CGRect(x: margin, y: margin, width: pageWidth - 2 * margin, height: 30)
            title.draw(in: titleRect, withAttributes: titleAttributes)

            let contentRect = CGRect(x: margin, y: margin + 50, width: pageWidth - 2 * margin, height: pageHeight - 2 * margin - 50)
            content.draw(in: contentRect, withAttributes: bodyAttributes)
        }

        return data
    }
}

// MARK: - Export Type

enum ExportType {
    case summaryPDF
    case summaryText
    case transcriptPDF
    case transcriptText
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
                transcript: transcript
            ) {
                showShareSheet = false
            }
            .presentationDetents([.medium])
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
            transcript: nil
        ) {}
    }
}
#endif
