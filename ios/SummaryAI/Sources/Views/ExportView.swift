import SwiftUI

// MARK: - Export View

/// View for exporting recording content
struct ExportView: View {
    let recording: Recording
    let summary: RecordingSummary?
    let transcript: Transcript?

    @Environment(\.dismiss) private var dismiss

    @State private var selectedFormat: ExportFormat = .pdf
    @State private var options = ExportOptions.summaryOnly
    @State private var isExporting = false
    @State private var exportError: String?
    @State private var showError = false
    @State private var exportedFileURL: URL?
    @State private var showShareSheet = false

    var body: some View {
        NavigationStack {
            Form {
                // Format selection
                Section("Export Format") {
                    Picker("Format", selection: $selectedFormat) {
                        ForEach(ExportFormat.allCases) { format in
                            Label(format.displayName, systemImage: format.icon)
                                .tag(format)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                // Content options
                Section("Content") {
                    Toggle("Summary", isOn: $options.includeSummary)
                        .disabled(summary == nil)

                    Toggle("Key Points", isOn: $options.includeKeyPoints)
                        .disabled(summary == nil || summary?.keyPoints.isEmpty == true)

                    Toggle("Action Items", isOn: $options.includeActionItems)
                        .disabled(summary == nil || summary?.actionItems?.isEmpty != false)

                    Toggle("Full Transcript", isOn: $options.includeTranscript)
                        .disabled(transcript == nil)

                    Toggle("Recording Info", isOn: $options.includeMetadata)
                }

                // Preview section
                Section("Preview") {
                    previewContent
                }
            }
            .navigationTitle("Export")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        exportAndShare()
                    } label: {
                        if isExporting {
                            ProgressView()
                        } else {
                            Text("Export")
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(isExporting || !hasContent)
                }
            }
            .alert("Export Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(exportError ?? "An error occurred")
            }
            .sheet(isPresented: $showShareSheet) {
                if let url = exportedFileURL {
                    ShareSheet(items: [url])
                }
            }
        }
    }

    // MARK: - Preview Content

    private var previewContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !hasContent {
                Text("No content selected for export")
                    .foregroundColor(.secondary)
                    .italic()
            } else {
                // Title preview
                Text(recording.title)
                    .font(.headline)

                // Content indicators
                HStack(spacing: 16) {
                    if options.includeSummary && summary != nil {
                        Label("Summary", systemImage: "doc.text")
                            .font(.caption)
                            .foregroundColor(.blue)
                    }

                    if options.includeKeyPoints && !(summary?.keyPoints.isEmpty ?? true) {
                        Label("\(summary?.keyPoints.count ?? 0) points", systemImage: "list.bullet")
                            .font(.caption)
                            .foregroundColor(.green)
                    }

                    if options.includeActionItems && !(summary?.actionItems?.isEmpty ?? true) {
                        Label("\(summary?.actionItems?.count ?? 0) actions", systemImage: "checkmark.circle")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                if options.includeTranscript && transcript != nil {
                    Label("\(transcript?.segments.count ?? 0) transcript segments", systemImage: "text.alignleft")
                        .font(.caption)
                        .foregroundColor(.purple)
                }

                // Format info
                Divider()

                HStack {
                    Image(systemName: selectedFormat.icon)
                    Text(".\(selectedFormat.fileExtension) file")
                }
                .font(.caption)
                .foregroundColor(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Computed Properties

    private var hasContent: Bool {
        (options.includeSummary && summary != nil) ||
        (options.includeKeyPoints && !(summary?.keyPoints.isEmpty ?? true)) ||
        (options.includeActionItems && !(summary?.actionItems?.isEmpty ?? true)) ||
        (options.includeTranscript && transcript != nil) ||
        options.includeMetadata
    }

    // MARK: - Export Action

    private func exportAndShare() {
        isExporting = true

        Task {
            do {
                let url = try ExportService.shared.export(
                    recording: recording,
                    summary: summary,
                    transcript: transcript,
                    format: selectedFormat,
                    options: options
                )

                exportedFileURL = url
                showShareSheet = true

            } catch {
                exportError = error.localizedDescription
                showError = true
            }

            isExporting = false
        }
    }
}

// MARK: - Share Sheet

/// UIKit share sheet wrapper
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    var excludedActivityTypes: [UIActivity.ActivityType]? = nil

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let controller = UIActivityViewController(
            activityItems: items,
            applicationActivities: nil
        )
        controller.excludedActivityTypes = excludedActivityTypes
        return controller
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

// MARK: - Export Button for Detail View

/// Toolbar button to trigger export from detail view
struct ExportButton: View {
    let recording: Recording
    let summary: RecordingSummary?
    let transcript: Transcript?

    @State private var showExportSheet = false

    var body: some View {
        Button {
            showExportSheet = true
        } label: {
            Image(systemName: "square.and.arrow.up")
        }
        .disabled(summary == nil && transcript == nil)
        .sheet(isPresented: $showExportSheet) {
            ExportView(
                recording: recording,
                summary: summary,
                transcript: transcript
            )
        }
    }
}

// MARK: - Quick Export (Summary Only)

/// Quick export action that directly shares summary
struct QuickExportButton: View {
    let recording: Recording
    let summary: RecordingSummary?

    @State private var isExporting = false
    @State private var showShareSheet = false
    @State private var exportedURL: URL?
    @State private var showError = false
    @State private var errorMessage: String?

    var body: some View {
        Button {
            quickExport()
        } label: {
            if isExporting {
                ProgressView()
            } else {
                Label("Share Summary", systemImage: "square.and.arrow.up")
            }
        }
        .disabled(summary == nil || isExporting)
        .sheet(isPresented: $showShareSheet) {
            if let url = exportedURL {
                ShareSheet(items: [url])
            }
        }
        .alert("Export Failed", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "Unknown error")
        }
    }

    private func quickExport() {
        guard let summary = summary else { return }

        isExporting = true

        Task {
            do {
                let url = try ExportService.shared.export(
                    recording: recording,
                    summary: summary,
                    transcript: nil,
                    format: .pdf,
                    options: .summaryOnly
                )

                exportedURL = url
                showShareSheet = true

            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }

            isExporting = false
        }
    }
}

// MARK: - Preview

#if DEBUG
struct ExportView_Previews: PreviewProvider {
    static var previews: some View {
        ExportView(
            recording: Recording(
                id: "1",
                userId: "user",
                title: "Team Meeting",
                durationSeconds: 3600,
                fileSizeBytes: 1024000,
                filePath: nil,
                status: .completed,
                errorMessage: nil,
                speakerCount: 3,
                wordCount: 5000,
                language: "en",
                tags: nil,
                isFavorite: nil,
                createdAt: Date(),
                updatedAt: nil,
                processedAt: nil
            ),
            summary: RecordingSummary(
                id: "1",
                recordingId: "1",
                summary: "This was a productive team meeting...",
                keyPoints: ["Point 1", "Point 2"],
                actionItems: [ActionItem(id: "1", task: "Follow up", assignee: "John", dueDate: nil, priority: nil)],
                topics: ["Planning"],
                sentiment: nil,
                createdAt: Date()
            ),
            transcript: nil
        )
    }
}
#endif
