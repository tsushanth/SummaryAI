import Foundation
import Combine

/// Manages audio uploads using a background URLSession so they survive app
/// backgrounding, screen lock, and even app termination. iOS will resume the
/// app to deliver the completion callback once the upload finishes.
///
/// Persistent state lives in `<file>.upload.json` sidecar files next to the
/// audio file in `Documents/Recordings/`. The sidecar tracks where the
/// recording is in the create → PUT → complete flow, so we can resume after
/// a crash or termination.
@MainActor
final class BackgroundUploadManager: NSObject, ObservableObject {

    // MARK: - Notifications

    static let didCompleteNotification = Notification.Name("BackgroundUploadManager.didComplete")
    static let didFailNotification = Notification.Name("BackgroundUploadManager.didFail")
    static let progressNotification = Notification.Name("BackgroundUploadManager.progress")

    // MARK: - Pending Upload Model

    struct PendingUpload: Identifiable, Codable, Equatable {
        let id: String                  // recordingId from createRecording
        let title: String
        let durationSeconds: Int
        let fileSize: Int64
        let fileURL: URL
        let uploadURL: String
        let uploadHeaders: [String: String]
        let uploadMethod: String
        var taskIdentifier: Int?
        var status: Status
        var errorMessage: String?
        var createdAt: Date

        enum Status: String, Codable {
            case uploading
            case uploadedPendingComplete = "uploaded_pending_complete"
            case failed
        }
    }

    // MARK: - Singleton

    static let shared = BackgroundUploadManager()

    // MARK: - Published State

    @Published private(set) var pendingUploads: [PendingUpload] = []
    @Published private(set) var activeProgress: [String: Double] = [:]    // recordingId → 0..1

    // MARK: - Internal State

    private static let backgroundIdentifier = "com.kreativekoala.meetingmind.upload"
    private static let sidecarSuffix = ".upload.json"

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.backgroundIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.allowsCellularAccess = true
        config.timeoutIntervalForRequest = 300            // 5 min between bytes
        config.timeoutIntervalForResource = 60 * 60 * 6   // 6 hours total
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// AppDelegate stores its completionHandler here when iOS wakes us up to
    /// deliver background events. We invoke it after the delegate finishes.
    var backgroundCompletionHandler: (() -> Void)?

    /// Called when an upload's complete-upload API step finishes successfully.
    /// Set by APIClient/ViewModel so they can refresh state.
    var onUploadFinalized: ((_ recordingId: String) -> Void)?

    /// Hook for calling the backend complete-upload endpoint. Set at app init
    /// so the manager can call it from the background delegate without needing
    /// the APIClient instance directly.
    var completeUploadHandler: ((_ recordingId: String, _ fileSize: Int64) async throws -> Void)?

    // MARK: - Lifecycle

    private override init() {
        super.init()
        // Touch session lazily; we'll do that in resume()
    }

    /// Call once at app launch. Reconnects to in-flight tasks and resumes any
    /// pending complete-upload calls.
    func resume() {
        _ = session  // forces lazy init + reconnects to in-flight background tasks
        loadPendingUploadsFromDisk()
        Task { await reconcileWithActiveTasks() }
    }

    // MARK: - Public API

    /// Start a new upload. Persists a sidecar so the upload can be tracked
    /// across app launches. Caller should already have called createRecording
    /// to get the recordingId + uploadInfo.
    func startUpload(
        recordingId: String,
        title: String,
        durationSeconds: Int,
        fileURL: URL,
        uploadURL: String,
        uploadMethod: String,
        uploadHeaders: [String: String]
    ) throws {
        let fileSize = (try FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int64) ?? 0

        var pending = PendingUpload(
            id: recordingId,
            title: title,
            durationSeconds: durationSeconds,
            fileSize: fileSize,
            fileURL: fileURL,
            uploadURL: uploadURL,
            uploadHeaders: uploadHeaders,
            uploadMethod: uploadMethod,
            taskIdentifier: nil,
            status: .uploading,
            errorMessage: nil,
            createdAt: Date()
        )

        guard let url = URL(string: uploadURL) else {
            throw NSError(domain: "BackgroundUploadManager", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Invalid upload URL"])
        }

        var request = URLRequest(url: url)
        request.httpMethod = uploadMethod
        for (k, v) in uploadHeaders { request.setValue(v, forHTTPHeaderField: k) }
        request.setValue("\(fileSize)", forHTTPHeaderField: "Content-Length")

        let task = session.uploadTask(with: request, fromFile: fileURL)
        task.taskDescription = recordingId    // so we can recover recordingId from task later
        pending.taskIdentifier = task.taskIdentifier

        writeSidecar(pending)
        upsert(pending)
        task.resume()
        print("[BackgroundUpload] Started upload taskId=\(task.taskIdentifier) recordingId=\(recordingId)")
    }

    /// User-triggered retry: re-uses the same uploadInfo from the sidecar.
    /// If the signed URL has expired, retry will fail and the caller should
    /// re-issue createRecording (not currently automated — left as TODO).
    func retry(_ pending: PendingUpload) {
        guard FileManager.default.fileExists(atPath: pending.fileURL.path) else {
            discard(pending)
            return
        }
        do {
            try startUpload(
                recordingId: pending.id,
                title: pending.title,
                durationSeconds: pending.durationSeconds,
                fileURL: pending.fileURL,
                uploadURL: pending.uploadURL,
                uploadMethod: pending.uploadMethod,
                uploadHeaders: pending.uploadHeaders
            )
        } catch {
            var failed = pending
            failed.status = .failed
            failed.errorMessage = error.localizedDescription
            writeSidecar(failed)
            upsert(failed)
        }
    }

    /// User-triggered discard: removes audio + sidecar.
    func discard(_ pending: PendingUpload) {
        try? FileManager.default.removeItem(at: pending.fileURL)
        try? FileManager.default.removeItem(at: sidecarURL(for: pending.fileURL))
        pendingUploads.removeAll { $0.id == pending.id }
    }

    // MARK: - Private — Sidecar I/O

    private static let recordingsDir: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("Recordings", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private func sidecarURL(for fileURL: URL) -> URL {
        let base = fileURL.deletingPathExtension().lastPathComponent
        return Self.recordingsDir.appendingPathComponent(base + Self.sidecarSuffix)
    }

    private func writeSidecar(_ pending: PendingUpload) {
        do {
            let data = try JSONEncoder().encode(pending)
            try data.write(to: sidecarURL(for: pending.fileURL), options: .atomic)
        } catch {
            print("[BackgroundUpload] Failed to write sidecar: \(error)")
        }
    }

    private func loadPendingUploadsFromDisk() {
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: Self.recordingsDir,
            includingPropertiesForKeys: nil
        ) else {
            return
        }
        let sidecars = entries.filter { $0.lastPathComponent.hasSuffix(Self.sidecarSuffix) }
        let decoder = JSONDecoder()
        var loaded: [PendingUpload] = []
        for url in sidecars {
            guard let data = try? Data(contentsOf: url) else { continue }
            if let pending = try? decoder.decode(PendingUpload.self, from: data) {
                loaded.append(pending)
            }
        }
        pendingUploads = loaded.sorted { $0.createdAt > $1.createdAt }
        print("[BackgroundUpload] Loaded \(pendingUploads.count) pending uploads from disk")
    }

    private func upsert(_ pending: PendingUpload) {
        if let idx = pendingUploads.firstIndex(where: { $0.id == pending.id }) {
            pendingUploads[idx] = pending
        } else {
            pendingUploads.insert(pending, at: 0)
        }
    }

    // MARK: - Private — Reconciliation

    /// On app launch, reconcile sidecar state with what URLSession currently
    /// holds. Handles three cases:
    /// 1. Sidecar says "uploading", task still active → just observe it.
    /// 2. Sidecar says "uploading" but no task → mark failed.
    /// 3. Sidecar says "uploaded_pending_complete" → call complete-upload now.
    private func reconcileWithActiveTasks() async {
        let activeTasks = await session.allTasks
        let activeTaskIds = Set(activeTasks.map { $0.taskIdentifier })

        var updates: [PendingUpload] = []
        for var pending in pendingUploads {
            switch pending.status {
            case .uploading:
                if let taskId = pending.taskIdentifier, activeTaskIds.contains(taskId) {
                    // Task still alive — keep observing
                } else {
                    pending.status = .failed
                    pending.errorMessage = "Upload interrupted"
                    writeSidecar(pending)
                    updates.append(pending)
                }
            case .uploadedPendingComplete:
                await callCompleteUpload(for: pending)
            case .failed:
                break
            }
        }
        for u in updates { upsert(u) }
    }

    /// Calls the backend complete-upload API. On success, removes sidecar
    /// + audio file. On failure, leaves sidecar in uploadedPendingComplete
    /// so we retry on next launch.
    private func callCompleteUpload(for pending: PendingUpload) async {
        guard let handler = completeUploadHandler else {
            print("[BackgroundUpload] completeUploadHandler not set; cannot finalize \(pending.id)")
            return
        }
        do {
            try await handler(pending.id, pending.fileSize)
            // Success — clean up local state
            try? FileManager.default.removeItem(at: pending.fileURL)
            try? FileManager.default.removeItem(at: sidecarURL(for: pending.fileURL))
            pendingUploads.removeAll { $0.id == pending.id }
            activeProgress[pending.id] = nil
            onUploadFinalized?(pending.id)
            NotificationCenter.default.post(name: Self.didCompleteNotification, object: pending.id)
            print("[BackgroundUpload] Finalized \(pending.id)")
        } catch {
            print("[BackgroundUpload] complete-upload failed for \(pending.id): \(error)")
            // Leave sidecar so we retry on next app launch
        }
    }
}

// MARK: - URLSessionDelegate

extension BackgroundUploadManager: URLSessionDelegate, URLSessionDataDelegate, URLSessionTaskDelegate {

    // Per-task progress
    nonisolated func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        let progress = totalBytesExpectedToSend > 0
            ? Double(totalBytesSent) / Double(totalBytesExpectedToSend)
            : 0.0
        guard let recordingId = task.taskDescription else { return }
        Task { @MainActor in
            self.activeProgress[recordingId] = progress
            NotificationCenter.default.post(
                name: Self.progressNotification,
                object: nil,
                userInfo: ["recordingId": recordingId, "progress": progress]
            )
        }
    }

    // Per-task completion (PUT to GCS done)
    nonisolated func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        guard let recordingId = task.taskDescription else { return }
        let httpStatus = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let nsError = error as NSError?

        Task { @MainActor in
            guard var pending = self.pendingUploads.first(where: { $0.id == recordingId }) else {
                return
            }
            let putSucceeded = nsError == nil && (200...299).contains(httpStatus)
            if putSucceeded {
                pending.status = .uploadedPendingComplete
                self.writeSidecar(pending)
                self.upsert(pending)
                await self.callCompleteUpload(for: pending)
            } else {
                pending.status = .failed
                pending.errorMessage = nsError?.localizedDescription ?? "HTTP \(httpStatus)"
                self.writeSidecar(pending)
                self.upsert(pending)
                self.activeProgress[recordingId] = nil
                NotificationCenter.default.post(
                    name: Self.didFailNotification,
                    object: nil,
                    userInfo: ["recordingId": recordingId,
                               "error": pending.errorMessage ?? "Unknown"]
                )
                print("[BackgroundUpload] Upload failed \(recordingId): \(pending.errorMessage ?? "")")
            }
        }
    }

    // Called when the OS finishes delivering all background events to the app.
    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        Task { @MainActor in
            if let handler = self.backgroundCompletionHandler {
                self.backgroundCompletionHandler = nil
                handler()
            }
        }
    }
}
