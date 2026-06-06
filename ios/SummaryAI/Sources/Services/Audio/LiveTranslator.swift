import Foundation
import SwiftUI
import Combine
#if canImport(Translation)
import Translation
#endif

/// Drives live translation of a string property (typically the live transcript)
/// to English using Apple's Translation framework (iOS 17.4+). Debounces
/// updates so we don't queue a translation for every partial recognition
/// result. Falls back silently on older iOS — caller should display the
/// source text in that case.
@available(iOS 18.0, *)
@MainActor
final class LiveTranslator: ObservableObject {

    @Published private(set) var translatedText: String = ""
    @Published private(set) var errorMessage: String?

    private var session: TranslationSession?
    private var pendingText: String?
    private var inFlight: Task<Void, Never>?
    private var debounceTask: Task<Void, Never>?
    private var prepared: Bool = false

    /// Bind the active session — call from inside a `.translationTask` closure.
    /// Triggers `prepareTranslation()` so iOS surfaces the language-pack
    /// download UI on first use; without this, `translate()` fails with
    /// TranslationErrorDomain code 14 and there's no path to recovery.
    func bind(session: TranslationSession) {
        self.session = session
        prepared = false
        Task { [weak self] in
            do {
                try await session.prepareTranslation()
                await MainActor.run {
                    self?.prepared = true
                    if let queued = self?.pendingText { self?.schedule(queued) }
                }
            } catch {
                await MainActor.run {
                    self?.errorMessage = "Translation language pack unavailable for the selected source language."
                }
            }
        }
    }

    /// Reset state when configuration changes (e.g. source language change).
    func reset() {
        debounceTask?.cancel()
        inFlight?.cancel()
        session = nil
        translatedText = ""
        errorMessage = nil
        pendingText = nil
    }

    /// Submit new transcript text. Coalesces rapid updates via a 500ms debounce
    /// AND skips while a translation is in flight so we don't pile up cancelled
    /// requests (which surfaced as "Connection interrupted" floods).
    func submit(_ text: String) {
        guard !text.isEmpty else { return }
        pendingText = text
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled, let self = self else { return }
            if self.inFlight != nil { return }   // let the in-flight one finish first
            if !self.prepared { return }         // wait until prepareTranslation succeeds
            self.schedule(text)
        }
    }

    private func schedule(_ text: String) {
        inFlight = Task { [weak self] in
            defer { Task { @MainActor in self?.inFlight = nil } }
            guard let self = self, let session = self.session else { return }
            do {
                let response = try await session.translate(text)
                await MainActor.run { self.translatedText = response.targetText }
                // If new text arrived while we were translating, kick off another.
                if let next = await self.pendingText, next != text {
                    await MainActor.run { self.schedule(next) }
                }
            } catch {
                let nsError = error as NSError
                if nsError.domain == "TranslationErrorDomain", nsError.code == 14 {
                    await MainActor.run {
                        self.errorMessage = "Spanish→English translation pack isn't downloaded. Open Settings → General → Language & Region → Translation Languages."
                        self.prepared = false   // stop attempting until rebind
                    }
                } else {
                    await MainActor.run { self.errorMessage = error.localizedDescription }
                }
            }
        }
    }
}
