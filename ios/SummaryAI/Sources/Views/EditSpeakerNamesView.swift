import SwiftUI

/// Sheet UI for assigning custom names to each speaker in a recording.
/// Save calls back through `onSave` with the trimmed/non-empty map so the
/// caller can hit the existing `updateSpeakerNames` API.
struct EditSpeakerNamesView: View {
    let transcript: Transcript
    let onSave: ([String: String]) async -> Void
    let onDismiss: () -> Void

    @State private var draft: [String: String]
    @State private var isSaving = false

    init(
        transcript: Transcript,
        onSave: @escaping ([String: String]) async -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.transcript = transcript
        self.onSave = onSave
        self.onDismiss = onDismiss

        var initial: [String: String] = transcript.speakerNames ?? [:]
        // Seed every speaker index found in the segments so they all appear in
        // the editor even if the map is empty.
        for seg in transcript.segments {
            if let idx = seg.speakerIndex {
                let key = String(idx)
                if initial[key] == nil { initial[key] = "" }
            }
        }
        // Edge case: no segments yet (e.g. live recording without finalised
        // transcript) — show at least the speakerCount slots.
        if initial.isEmpty {
            for i in 0..<max(transcript.speakerCount, 1) {
                initial[String(i)] = ""
            }
        }
        _draft = State(initialValue: initial)
    }

    private var sortedKeys: [String] {
        draft.keys
            .compactMap { key -> (Int, String)? in
                guard let idx = Int(key) else { return nil }
                return (idx, key)
            }
            .sorted { $0.0 < $1.0 }
            .map { $0.1 }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(sortedKeys, id: \.self) { key in
                        HStack(spacing: 12) {
                            Text("Speaker \(key)")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                                .frame(width: 90, alignment: .leading)
                            TextField("Name (optional)", text: Binding(
                                get: { draft[key] ?? "" },
                                set: { draft[key] = $0 }
                            ))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.words)
                        }
                    }
                } footer: {
                    Text("Names replace “Speaker 0”, “Speaker 1”, etc. in the transcript, summary, and shared exports. Leave blank to keep the default.")
                }
            }
            .navigationTitle("Rename Speakers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        save()
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private func save() {
        isSaving = true
        let filtered: [String: String] = draft.reduce(into: [:]) { acc, kv in
            let trimmed = kv.value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { acc[kv.key] = trimmed }
        }
        Task {
            await onSave(filtered)
            await MainActor.run {
                isSaving = false
                onDismiss()
            }
        }
    }
}
