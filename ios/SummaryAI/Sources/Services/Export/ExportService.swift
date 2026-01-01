import Foundation
import PDFKit
import UIKit

// MARK: - Export Format

/// Supported export formats
enum ExportFormat: String, CaseIterable, Identifiable {
    case plainText = "txt"
    case pdf = "pdf"
    case markdown = "md"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .plainText: return "Plain Text"
        case .pdf: return "PDF"
        case .markdown: return "Markdown"
        }
    }

    var fileExtension: String { rawValue }

    var mimeType: String {
        switch self {
        case .plainText: return "text/plain"
        case .pdf: return "application/pdf"
        case .markdown: return "text/markdown"
        }
    }

    var icon: String {
        switch self {
        case .plainText: return "doc.text"
        case .pdf: return "doc.richtext"
        case .markdown: return "doc.plaintext"
        }
    }
}

// MARK: - Export Options

/// Options for customizing export content
struct ExportOptions {
    var includeSummary: Bool = true
    var includeKeyPoints: Bool = true
    var includeActionItems: Bool = true
    var includeTranscript: Bool = false
    var includeMetadata: Bool = true

    static let summaryOnly = ExportOptions(
        includeSummary: true,
        includeKeyPoints: true,
        includeActionItems: true,
        includeTranscript: false,
        includeMetadata: true
    )

    static let full = ExportOptions(
        includeSummary: true,
        includeKeyPoints: true,
        includeActionItems: true,
        includeTranscript: true,
        includeMetadata: true
    )
}

// MARK: - Export Error

enum ExportError: Error, LocalizedError {
    case noContent
    case pdfGenerationFailed
    case fileWriteFailed(Error)

    var errorDescription: String? {
        switch self {
        case .noContent:
            return "No content available to export"
        case .pdfGenerationFailed:
            return "Failed to generate PDF"
        case .fileWriteFailed(let error):
            return "Failed to write file: \(error.localizedDescription)"
        }
    }
}

// MARK: - Export Service

/// Service for exporting recordings to various formats
final class ExportService {

    // MARK: - Singleton

    static let shared = ExportService()
    private init() {}

    // MARK: - Export

    /// Export recording to the specified format
    /// - Parameters:
    ///   - recording: The recording to export
    ///   - summary: Optional summary data
    ///   - transcript: Optional transcript data
    ///   - format: Export format
    ///   - options: Export options
    /// - Returns: URL to the exported file
    func export(
        recording: Recording,
        summary: RecordingSummary?,
        transcript: Transcript?,
        format: ExportFormat,
        options: ExportOptions = .summaryOnly
    ) throws -> URL {
        // Generate content
        let content = generateContent(
            recording: recording,
            summary: summary,
            transcript: transcript,
            options: options
        )

        guard !content.isEmpty else {
            throw ExportError.noContent
        }

        // Create file URL
        let fileName = sanitizeFileName(recording.title)
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(fileName)
            .appendingPathExtension(format.fileExtension)

        // Generate and write file
        switch format {
        case .plainText:
            try writePlainText(content: content, to: fileURL)

        case .markdown:
            let markdown = generateMarkdown(
                recording: recording,
                summary: summary,
                transcript: transcript,
                options: options
            )
            try writePlainText(content: markdown, to: fileURL)

        case .pdf:
            try generatePDF(
                recording: recording,
                summary: summary,
                transcript: transcript,
                options: options,
                to: fileURL
            )
        }

        return fileURL
    }

    // MARK: - Content Generation

    private func generateContent(
        recording: Recording,
        summary: RecordingSummary?,
        transcript: Transcript?,
        options: ExportOptions
    ) -> String {
        var lines: [String] = []

        // Title
        lines.append(recording.title)
        lines.append(String(repeating: "=", count: recording.title.count))
        lines.append("")

        // Metadata
        if options.includeMetadata {
            let dateFormatter = DateFormatter()
            dateFormatter.dateStyle = .long
            dateFormatter.timeStyle = .short

            lines.append("Date: \(dateFormatter.string(from: recording.createdAt))")

            if let duration = recording.durationSeconds {
                lines.append("Duration: \(formatDuration(duration))")
            }

            lines.append("")
        }

        // Summary
        if options.includeSummary, let summary = summary {
            lines.append("SUMMARY")
            lines.append("-------")
            lines.append(summary.summary)
            lines.append("")
        }

        // Key Points
        if options.includeKeyPoints, let summary = summary, !summary.keyPoints.isEmpty {
            lines.append("KEY POINTS")
            lines.append("----------")
            for point in summary.keyPoints {
                lines.append("• \(point)")
            }
            lines.append("")
        }

        // Action Items
        if options.includeActionItems, let summary = summary, let actionItems = summary.actionItems, !actionItems.isEmpty {
            lines.append("ACTION ITEMS")
            lines.append("------------")
            for item in actionItems {
                var line = "☐ \(item.task)"
                if let assignee = item.assignee {
                    line += " (@\(assignee))"
                }
                lines.append(line)
            }
            lines.append("")
        }

        // Transcript
        if options.includeTranscript, let transcript = transcript {
            lines.append("TRANSCRIPT")
            lines.append("----------")
            for segment in transcript.segments {
                let timestamp = formatTimestamp(segment.startTime)
                let speaker = segment.speaker ?? "Speaker"
                lines.append("[\(timestamp)] \(speaker): \(segment.text)")
            }
            lines.append("")
        }

        // Footer
        lines.append("---")
        lines.append("Exported from Summary AI")

        return lines.joined(separator: "\n")
    }

    private func generateMarkdown(
        recording: Recording,
        summary: RecordingSummary?,
        transcript: Transcript?,
        options: ExportOptions
    ) -> String {
        var lines: [String] = []

        // Title
        lines.append("# \(recording.title)")
        lines.append("")

        // Metadata
        if options.includeMetadata {
            let dateFormatter = DateFormatter()
            dateFormatter.dateStyle = .long
            dateFormatter.timeStyle = .short

            lines.append("**Date:** \(dateFormatter.string(from: recording.createdAt))")

            if let duration = recording.durationSeconds {
                lines.append("**Duration:** \(formatDuration(duration))")
            }

            lines.append("")
        }

        // Summary
        if options.includeSummary, let summary = summary {
            lines.append("## Summary")
            lines.append("")
            lines.append(summary.summary)
            lines.append("")
        }

        // Key Points
        if options.includeKeyPoints, let summary = summary, !summary.keyPoints.isEmpty {
            lines.append("## Key Points")
            lines.append("")
            for point in summary.keyPoints {
                lines.append("- \(point)")
            }
            lines.append("")
        }

        // Action Items
        if options.includeActionItems, let summary = summary, let actionItems = summary.actionItems, !actionItems.isEmpty {
            lines.append("## Action Items")
            lines.append("")
            for item in actionItems {
                var line = "- [ ] \(item.task)"
                if let assignee = item.assignee {
                    line += " *(@\(assignee))*"
                }
                lines.append(line)
            }
            lines.append("")
        }

        // Transcript
        if options.includeTranscript, let transcript = transcript {
            lines.append("## Transcript")
            lines.append("")
            for segment in transcript.segments {
                let timestamp = formatTimestamp(segment.startTime)
                let speaker = segment.speaker ?? "Speaker"
                lines.append("**[\(timestamp)] \(speaker):** \(segment.text)")
                lines.append("")
            }
        }

        // Footer
        lines.append("---")
        lines.append("*Exported from Summary AI*")

        return lines.joined(separator: "\n")
    }

    // MARK: - PDF Generation

    private func generatePDF(
        recording: Recording,
        summary: RecordingSummary?,
        transcript: Transcript?,
        options: ExportOptions,
        to url: URL
    ) throws {
        let pageWidth: CGFloat = 612 // Letter size
        let pageHeight: CGFloat = 792
        let margin: CGFloat = 50

        let contentWidth = pageWidth - (margin * 2)

        // Create PDF context
        UIGraphicsBeginPDFContextToFile(url.path, CGRect.zero, nil)
        defer { UIGraphicsEndPDFContext() }

        var currentY: CGFloat = margin
        let lineSpacing: CGFloat = 6

        // Helper to check if we need a new page
        func checkNewPage(neededHeight: CGFloat) {
            if currentY + neededHeight > pageHeight - margin {
                UIGraphicsBeginPDFPage()
                currentY = margin
            }
        }

        // Helper to draw text
        func drawText(_ text: String, font: UIFont, color: UIColor = .black) {
            let paragraphStyle = NSMutableParagraphStyle()
            paragraphStyle.lineSpacing = lineSpacing

            let attributes: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraphStyle
            ]

            let attributedString = NSAttributedString(string: text, attributes: attributes)
            let textRect = CGRect(x: margin, y: currentY, width: contentWidth, height: pageHeight - currentY - margin)

            let boundingRect = attributedString.boundingRect(
                with: CGSize(width: contentWidth, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                context: nil
            )

            checkNewPage(neededHeight: boundingRect.height)

            attributedString.draw(in: CGRect(x: margin, y: currentY, width: contentWidth, height: boundingRect.height))
            currentY += boundingRect.height + lineSpacing
        }

        // Start first page
        UIGraphicsBeginPDFPage()

        // Title
        let titleFont = UIFont.systemFont(ofSize: 24, weight: .bold)
        drawText(recording.title, font: titleFont)
        currentY += 10

        // Metadata
        if options.includeMetadata {
            let dateFormatter = DateFormatter()
            dateFormatter.dateStyle = .long
            dateFormatter.timeStyle = .short

            let metaFont = UIFont.systemFont(ofSize: 12)
            drawText("Date: \(dateFormatter.string(from: recording.createdAt))", font: metaFont, color: .darkGray)

            if let duration = recording.durationSeconds {
                drawText("Duration: \(formatDuration(duration))", font: metaFont, color: .darkGray)
            }

            currentY += 15
        }

        // Summary
        if options.includeSummary, let summary = summary {
            let headingFont = UIFont.systemFont(ofSize: 16, weight: .semibold)
            let bodyFont = UIFont.systemFont(ofSize: 12)

            drawText("Summary", font: headingFont)
            currentY += 5
            drawText(summary.summary, font: bodyFont)
            currentY += 15
        }

        // Key Points
        if options.includeKeyPoints, let summary = summary, !summary.keyPoints.isEmpty {
            let headingFont = UIFont.systemFont(ofSize: 16, weight: .semibold)
            let bodyFont = UIFont.systemFont(ofSize: 12)

            drawText("Key Points", font: headingFont)
            currentY += 5

            for point in summary.keyPoints {
                drawText("• \(point)", font: bodyFont)
            }
            currentY += 15
        }

        // Action Items
        if options.includeActionItems, let summary = summary, let actionItems = summary.actionItems, !actionItems.isEmpty {
            let headingFont = UIFont.systemFont(ofSize: 16, weight: .semibold)
            let bodyFont = UIFont.systemFont(ofSize: 12)

            drawText("Action Items", font: headingFont)
            currentY += 5

            for item in actionItems {
                var line = "☐ \(item.task)"
                if let assignee = item.assignee {
                    line += " (@\(assignee))"
                }
                drawText(line, font: bodyFont)
            }
            currentY += 15
        }

        // Transcript
        if options.includeTranscript, let transcript = transcript {
            let headingFont = UIFont.systemFont(ofSize: 16, weight: .semibold)
            let bodyFont = UIFont.systemFont(ofSize: 11)
            let timestampFont = UIFont.monospacedDigitSystemFont(ofSize: 10, weight: .medium)

            drawText("Transcript", font: headingFont)
            currentY += 5

            for segment in transcript.segments {
                let timestamp = formatTimestamp(segment.startTime)
                let speaker = segment.speaker ?? "Speaker"
                drawText("[\(timestamp)] \(speaker):", font: timestampFont, color: .blue)
                drawText(segment.text, font: bodyFont)
                currentY += 5
            }
        }

        // Footer
        currentY += 20
        let footerFont = UIFont.systemFont(ofSize: 10)
        drawText("Exported from Summary AI", font: footerFont, color: .gray)
    }

    // MARK: - File Operations

    private func writePlainText(content: String, to url: URL) throws {
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            throw ExportError.fileWriteFailed(error)
        }
    }

    // MARK: - Helpers

    private func sanitizeFileName(_ name: String) -> String {
        let invalidCharacters = CharacterSet(charactersIn: "/\\?%*|\"<>:")
        return name.components(separatedBy: invalidCharacters).joined(separator: "_")
    }

    private func formatDuration(_ seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        let secs = seconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        } else {
            return String(format: "%d:%02d", minutes, secs)
        }
    }

    private func formatTimestamp(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}
