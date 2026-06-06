import Foundation
import PaywallKit

// MARK: - API Configuration

/// Configuration for the API client
struct APIConfiguration {
    let baseURL: URL
    let apiVersion: String

    var apiURL: URL {
        baseURL.appendingPathComponent(apiVersion)
    }

    static let production = APIConfiguration(
        baseURL: URL(string: "https://summary-ai-backend.fly.dev")!,
        apiVersion: "v1"
    )

    static let staging = APIConfiguration(
        baseURL: URL(string: "https://summary-ai-backend.fly.dev")!,
        apiVersion: "v1"
    )

    static let development = APIConfiguration(
        baseURL: URL(string: "http://localhost:8080")!,
        apiVersion: "v1"
    )

    /// Supabase configuration - uses Supabase Edge Functions or REST API
    static let supabase = APIConfiguration(
        baseURL: URL(string: "https://mlofjzlmncgnhxbiuemf.supabase.co/rest")!,
        apiVersion: "v1"
    )
}

// MARK: - Upload Progress

/// Represents upload progress
struct UploadProgress {
    let bytesUploaded: Int64
    let totalBytes: Int64

    var fractionCompleted: Double {
        guard totalBytes > 0 else { return 0 }
        return Double(bytesUploaded) / Double(totalBytes)
    }

    var percentCompleted: Int {
        Int(fractionCompleted * 100)
    }
}

// MARK: - API Client

/// Client for interacting with the Summary AI backend
@MainActor
final class SummaryAIAPIClient: NSObject, ObservableObject {

    // MARK: - Published Properties

    @Published private(set) var isUploading = false
    @Published private(set) var uploadProgress: UploadProgress?

    // MARK: - Properties

    private let configuration: APIConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    /// Access token provider - should be set by auth service
    var accessTokenProvider: (() async -> String?)?

    /// Token refresh handler - called when a 401 is received to refresh the token
    var tokenRefreshHandler: (() async throws -> Void)?

    // MARK: - Upload State

    private var uploadTask: URLSessionUploadTask?
    private var uploadContinuation: CheckedContinuation<Void, Error>?

    // MARK: - Initialization

    init(configuration: APIConfiguration = .production) {
        self.configuration = configuration

        // Configure session for uploads
        let sessionConfig = URLSessionConfiguration.default
        sessionConfig.timeoutIntervalForRequest = 30
        sessionConfig.timeoutIntervalForResource = 600  // 10 minutes for large uploads

        self.session = URLSession(configuration: sessionConfig)

        // Configure decoder
        self.decoder = JSONDecoder()
        self.decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)

            // Try ISO8601 with fractional seconds
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: dateString) {
                return date
            }

            // Fallback without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: dateString) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date: \(dateString)"
            )
        }

        // Configure encoder
        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601

        super.init()
    }

    // MARK: - Consent Check

    /// Verifies the user has consented to AI data sharing before sending data to cloud services
    private func requireAIConsent() async throws {
        let hasConsent = await MainActor.run { AIDataConsentManager.shared.hasConsented }
        guard hasConsent else {
            throw APIError.consentRequired
        }
    }

    // MARK: - Recording API

    /// Create a new recording and get upload URL
    /// - Parameters:
    ///   - title: Recording title
    ///   - duration: Duration in seconds
    ///   - fileSize: File size in bytes
    /// - Returns: Create recording response with upload URL
    func createRecording(
        title: String,
        duration: Int,
        fileSize: Int64,
        outputLanguage: String? = nil
    ) async throws -> CreateRecordingResponse {
        let request = CreateRecordingRequest(
            title: title,
            durationSeconds: duration,
            fileSizeBytes: fileSize,
            contentType: "audio/mp4",
            outputLanguage: outputLanguage
        )

        return try await post(
            endpoint: "/api/recordings",
            body: request,
            responseType: CreateRecordingResponse.self
        )
    }

    /// Upload audio file to the provided URL
    /// - Parameters:
    ///   - fileURL: Local file URL
    ///   - uploadInfo: Upload information from createRecording
    ///   - progressHandler: Optional progress callback
    func uploadAudioFile(
        fileURL: URL,
        uploadInfo: UploadInfo,
        progressHandler: ((UploadProgress) -> Void)? = nil
    ) async throws {
        guard let uploadURL = URL(string: uploadInfo.url) else {
            throw APIError.invalidURL
        }

        // Get file size
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let fileSize = fileAttributes[.size] as? Int64 ?? 0

        // Create request
        var request = URLRequest(url: uploadURL)
        request.httpMethod = uploadInfo.method
        request.timeoutInterval = 600  // 10 minutes

        // Set headers from upload info
        for (key, value) in uploadInfo.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        // Set content length
        request.setValue(String(fileSize), forHTTPHeaderField: "Content-Length")

        isUploading = true
        uploadProgress = UploadProgress(bytesUploaded: 0, totalBytes: fileSize)

        defer {
            isUploading = false
            uploadProgress = nil
        }

        // Create upload task with progress tracking
        let (_, response) = try await uploadWithProgress(
            request: request,
            fileURL: fileURL,
            fileSize: fileSize,
            progressHandler: progressHandler
        )

        // Check response
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.networkError(NSError(domain: "Upload", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"]))
        }

        // Supabase returns 200 for successful uploads
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(statusCode: httpResponse.statusCode, message: "Upload failed")
        }

        print("[APIClient] Upload completed successfully")
    }

    /// Signal that upload is complete and trigger processing
    /// - Parameters:
    ///   - recordingId: Recording ID
    ///   - fileSize: Optional file size for verification
    /// - Returns: Complete upload response
    func completeUpload(
        recordingId: String,
        fileSize: Int64? = nil
    ) async throws -> CompleteUploadResponse {
        let request = CompleteUploadRequest(
            fileSizeBytes: fileSize,
            checksum: nil
        )

        return try await post(
            endpoint: "/api/recordings/\(recordingId)/complete-upload",
            body: request,
            responseType: CompleteUploadResponse.self
        )
    }

    /// Kick off a background upload. Returns the createRecording response so
    /// the caller knows the recordingId immediately, but the audio PUT happens
    /// in a background URLSession and completes asynchronously — observe
    /// `BackgroundUploadManager` notifications for completion.
    ///
    /// This replaced the prior synchronous flow because long uploads were
    /// being killed when the app got suspended.
    func uploadRecording(
        title: String,
        fileURL: URL,
        duration: TimeInterval,
        outputLanguage: String? = nil,
        progressHandler: ((UploadProgress) -> Void)? = nil
    ) async throws -> Recording {
        try await requireAIConsent()
        let fileSize = (try FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int64) ?? 0

        print("[APIClient] Starting upload flow for '\(title)' (\(fileSize) bytes)")
        let createResponse = try await createRecording(
            title: title,
            duration: Int(duration),
            fileSize: fileSize,
            outputLanguage: outputLanguage
        )
        print("[APIClient] Recording created: \(createResponse.recording.id) — handing off to background uploader")

        try await MainActor.run {
            try BackgroundUploadManager.shared.startUpload(
                recordingId: createResponse.recording.id,
                title: title,
                durationSeconds: Int(duration),
                fileURL: fileURL,
                uploadURL: createResponse.upload.url,
                uploadMethod: createResponse.upload.method,
                uploadHeaders: createResponse.upload.headers
            )
        }

        // Return the recording immediately. UI should treat this as "uploading"
        // and listen for BackgroundUploadManager.didCompleteNotification to
        // flip into "processing".
        return createResponse.recording
    }

    /// Import a file (audio or PDF)
    /// - Parameters:
    ///   - fileURL: Local file URL
    ///   - progressHandler: Optional progress callback
    /// - Returns: The created recording
    func importFile(
        fileURL: URL,
        progressHandler: ((UploadProgress) -> Void)? = nil
    ) async throws -> Recording {
        try await requireAIConsent()
        // Start accessing the security-scoped resource
        guard fileURL.startAccessingSecurityScopedResource() else {
            throw APIError.fileError("Unable to access file")
        }
        defer { fileURL.stopAccessingSecurityScopedResource() }

        // Get file info
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let fileSize = fileAttributes[.size] as? Int64 ?? 0
        let fileName = fileURL.deletingPathExtension().lastPathComponent
        let fileExtension = fileURL.pathExtension.lowercased()

        // Determine content type and recording type
        let contentType: String
        let recordingType: String

        switch fileExtension {
        case "pdf":
            contentType = "application/pdf"
            recordingType = "imported"
        case "m4a", "mp4":
            contentType = "audio/mp4"
            recordingType = "imported"
        case "mp3":
            contentType = "audio/mpeg"
            recordingType = "imported"
        case "wav":
            contentType = "audio/wav"
            recordingType = "imported"
        default:
            contentType = "audio/mp4"
            recordingType = "imported"
        }

        print("[APIClient] Importing file '\(fileName)' (\(fileSize) bytes, \(contentType))")

        // Step 1: Create recording with appropriate content type
        let request = CreateRecordingRequest(
            title: fileName,
            durationSeconds: nil,
            fileSizeBytes: fileSize,
            contentType: contentType,
            recordingType: recordingType
        )

        let createResponse: CreateRecordingResponse = try await post(
            endpoint: "/api/recordings",
            body: request,
            responseType: CreateRecordingResponse.self
        )

        print("[APIClient] Recording created: \(createResponse.recording.id)")

        // Step 2: Upload file to storage
        try await uploadAudioFile(
            fileURL: fileURL,
            uploadInfo: createResponse.upload,
            progressHandler: progressHandler
        )

        // Step 3: Signal upload complete
        let completeResponse = try await completeUpload(
            recordingId: createResponse.recording.id,
            fileSize: fileSize
        )

        print("[APIClient] Import complete. Job ID: \(completeResponse.job.id)")

        return completeResponse.recording
    }

    /// Get list of recordings
    /// - Parameters:
    ///   - page: Page number (1-based)
    ///   - perPage: Items per page
    ///   - status: Optional status filter
    /// - Returns: List recordings response
    func getRecordings(
        page: Int = 1,
        perPage: Int = 20,
        status: RecordingStatus? = nil
    ) async throws -> ListRecordingsResponse {
        var queryItems = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "per_page", value: String(perPage)),
            URLQueryItem(name: "sort", value: "created_at"),
            URLQueryItem(name: "order", value: "desc")
        ]

        if let status = status {
            queryItems.append(URLQueryItem(name: "status", value: status.rawValue))
        }

        return try await get(
            endpoint: "/api/recordings",
            queryItems: queryItems,
            responseType: ListRecordingsResponse.self
        )
    }

    /// Get a single recording with details
    /// - Parameters:
    ///   - id: Recording ID
    ///   - includeTranscript: Whether to include transcript
    ///   - includeSummary: Whether to include summary
    /// - Returns: Recording response
    func getRecording(
        id: String,
        includeTranscript: Bool = false,
        includeSummary: Bool = false
    ) async throws -> GetRecordingResponse {
        var includes: [String] = []
        if includeTranscript { includes.append("transcript") }
        if includeSummary { includes.append("summary") }

        var queryItems: [URLQueryItem] = []
        if !includes.isEmpty {
            queryItems.append(URLQueryItem(name: "include", value: includes.joined(separator: ",")))
        }

        return try await get(
            endpoint: "/api/recordings/\(id)",
            queryItems: queryItems,
            responseType: GetRecordingResponse.self
        )
    }

    /// Delete a recording
    /// - Parameter id: Recording ID
    func deleteRecording(id: String) async throws {
        try await delete(endpoint: "/api/recordings/\(id)")
    }

    /// Update recording metadata
    /// - Parameters:
    ///   - id: Recording ID
    ///   - title: New title (optional)
    ///   - isFavorite: New favorite status (optional)
    /// - Returns: Updated recording
    func updateRecording(
        id: String,
        title: String? = nil,
        isFavorite: Bool? = nil
    ) async throws -> Recording {
        struct UpdateRequest: Encodable {
            let title: String?
            let is_favorite: Bool?
        }

        struct UpdateResponse: Decodable {
            let recording: Recording
        }

        let request = UpdateRequest(title: title, is_favorite: isFavorite)
        let response: UpdateResponse = try await patchWithResponse(
            endpoint: "/api/recordings/\(id)",
            body: request,
            responseType: UpdateResponse.self
        )
        return response.recording
    }

    // MARK: - User Account API

    /// Delete the current user's account and all associated data
    func deleteAccount() async throws {
        try await delete(endpoint: "/api/users/account")
    }

    // MARK: - Live Transcript API

    /// Get live transcript segments for a meeting in progress
    /// - Parameters:
    ///   - meetingId: The meeting ID
    ///   - since: Optional timestamp to fetch only segments created after this time
    /// - Returns: Live transcript response with segments
    func getLiveTranscript(meetingId: String, since: Date? = nil) async throws -> LiveTranscriptResponse {
        var queryItems: [URLQueryItem] = []

        if let since = since {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            queryItems.append(URLQueryItem(name: "since", value: formatter.string(from: since)))
        }

        return try await get(
            endpoint: "/api/meetings/\(meetingId)/live-transcript",
            queryItems: queryItems,
            responseType: LiveTranscriptResponse.self
        )
    }

    // MARK: - Todos API

    /// Get list of todos
    /// - Parameters:
    ///   - page: Page number (1-based)
    ///   - perPage: Items per page
    ///   - completed: Filter by completion status (nil for all)
    /// - Returns: List todos response
    func getTodos(
        page: Int = 1,
        perPage: Int = 50,
        completed: Bool? = nil
    ) async throws -> ListTodosResponse {
        var queryItems = [
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "per_page", value: String(perPage)),
            URLQueryItem(name: "sort", value: "created_at"),
            URLQueryItem(name: "order", value: "desc")
        ]

        if let completed = completed {
            queryItems.append(URLQueryItem(name: "completed", value: completed ? "true" : "false"))
        } else {
            queryItems.append(URLQueryItem(name: "completed", value: "all"))
        }

        return try await get(
            endpoint: "/api/todos",
            queryItems: queryItems,
            responseType: ListTodosResponse.self
        )
    }

    /// Create a new todo
    /// - Parameter request: Todo creation request
    /// - Returns: Created todo
    func createTodo(request: CreateTodoRequest) async throws -> TodoItem {
        let response: TodoResponse = try await post(
            endpoint: "/api/todos",
            body: request,
            responseType: TodoResponse.self
        )
        return response.todo
    }

    /// Create todos from transcribed text
    /// - Parameter request: Text to parse into todos
    /// - Returns: Created todos
    func createTodosFromText(request: CreateTodosFromTextRequest) async throws -> [TodoItem] {
        try await requireAIConsent()
        let response: TodosResponse = try await post(
            endpoint: "/api/todos/from-text",
            body: request,
            responseType: TodosResponse.self
        )
        return response.todos
    }

    /// Toggle todo completion status
    /// - Parameter id: Todo ID
    /// - Returns: Updated todo
    func toggleTodo(id: String) async throws -> TodoItem {
        let response: TodoResponse = try await post(
            endpoint: "/api/todos/\(id)/toggle",
            body: EmptyRequest(),
            responseType: TodoResponse.self
        )
        return response.todo
    }

    /// Update a todo
    /// - Parameters:
    ///   - id: Todo ID
    ///   - request: Update request
    /// - Returns: Updated todo
    func updateTodo(id: String, request: UpdateTodoRequest) async throws -> TodoItem {
        let response: TodoResponse = try await patchWithResponse(
            endpoint: "/api/todos/\(id)",
            body: request,
            responseType: TodoResponse.self
        )
        return response.todo
    }

    /// Delete a todo
    /// - Parameter id: Todo ID
    func deleteTodo(id: String) async throws {
        try await delete(endpoint: "/api/todos/\(id)")
    }

    // MARK: - HTTP Methods

    func get<T: Decodable>(
        endpoint: String,
        queryItems: [URLQueryItem] = [],
        responseType: T.Type
    ) async throws -> T {
        let url = try buildURL(endpoint: endpoint, queryItems: queryItems)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        return try await performRequest(request, responseType: responseType)
    }

    func post<Body: Encodable, Response: Decodable>(
        endpoint: String,
        body: Body,
        responseType: Response.Type
    ) async throws -> Response {
        let url = try buildURL(endpoint: endpoint)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            request.httpBody = try encoder.encode(body)
        } catch {
            throw APIError.encodingFailed(error)
        }

        return try await performRequest(request, responseType: responseType)
    }

    func delete(endpoint: String) async throws {
        let url = try buildURL(endpoint: endpoint)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        let _: EmptyResponse = try await performRequest(request, responseType: EmptyResponse.self, allowEmpty: true)
    }

    func patch<Body: Encodable>(
        endpoint: String,
        body: Body
    ) async throws {
        let url = try buildURL(endpoint: endpoint)
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            request.httpBody = try encoder.encode(body)
        } catch {
            throw APIError.encodingFailed(error)
        }

        let _: EmptyResponse = try await performRequest(request, responseType: EmptyResponse.self, allowEmpty: true)
    }

    func patchWithResponse<Body: Encodable, Response: Decodable>(
        endpoint: String,
        body: Body,
        responseType: Response.Type
    ) async throws -> Response {
        let url = try buildURL(endpoint: endpoint)
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        do {
            request.httpBody = try encoder.encode(body)
        } catch {
            throw APIError.encodingFailed(error)
        }

        return try await performRequest(request, responseType: responseType)
    }

    // MARK: - Request Execution

    private func performRequest<T: Decodable>(
        _ request: URLRequest,
        responseType: T.Type,
        allowEmpty: Bool = false,
        isRetry: Bool = false
    ) async throws -> T {
        var request = request

        // Debug: Log the request URL
        print("[APIClient] Making request to: \(request.url?.absoluteString ?? "nil")\(isRetry ? " (retry)" : "")")

        // Add auth header
        if let token = await accessTokenProvider?() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            print("[APIClient] Token available, length: \(token.count)")
        } else {
            print("[APIClient] No access token available")
            throw APIError.noAccessToken
        }

        // Add common headers
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        // Send subscription status so server can skip free-tier limits for subscribed users
        if StoreManager.shared.isPremium {
            request.setValue("true", forHTTPHeaderField: "x-subscription-active")
        }

        do {
            print("[APIClient] Sending request...")
            let (data, response) = try await session.data(for: request)
            print("[APIClient] Response received")

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.networkError(NSError(domain: "API", code: -1, userInfo: nil))
            }

            // Handle HTTP errors
            switch httpResponse.statusCode {
            case 200...299:
                break
            case 401:
                // If this is already a retry, don't try again
                if isRetry {
                    print("[APIClient] 401 on retry - token refresh didn't help")
                    throw APIError.unauthorized
                }

                // Try to refresh the token and retry
                if let refreshHandler = tokenRefreshHandler {
                    print("[APIClient] Received 401 - attempting token refresh...")
                    do {
                        try await refreshHandler()
                        print("[APIClient] Token refresh succeeded - retrying request")
                        // Retry the request with the new token
                        return try await performRequest(request, responseType: responseType, allowEmpty: allowEmpty, isRetry: true)
                    } catch {
                        print("[APIClient] Token refresh failed: \(error)")
                        throw APIError.unauthorized
                    }
                } else {
                    print("[APIClient] No token refresh handler configured")
                    throw APIError.unauthorized
                }
            case 403:
                let body = String(data: data, encoding: .utf8) ?? "no body"
                print("[APIClient] ❌ 403 Forbidden - URL: \(request.url?.absoluteString ?? "?") Body: \(body)")
                // Check if subscription required
                if let errorResponse = try? decoder.decode(APIErrorResponse.self, from: data),
                   errorResponse.error.code == "SUBSCRIPTION_REQUIRED" {
                    throw APIError.subscriptionRequired
                }
                throw APIError.forbidden
            case 404:
                throw APIError.notFound
            case 500...599:
                let errorMessage = try? decoder.decode(APIErrorResponse.self, from: data).error.message
                throw APIError.serverError(message: errorMessage)
            default:
                let errorMessage = try? decoder.decode(APIErrorResponse.self, from: data).error.message
                throw APIError.httpError(statusCode: httpResponse.statusCode, message: errorMessage)
            }

            // Handle empty responses
            if allowEmpty && data.isEmpty {
                // Return empty response for DELETE etc.
                if let empty = EmptyResponse() as? T {
                    return empty
                }
            }

            // Decode response
            do {
                return try decoder.decode(T.self, from: data)
            } catch {
                throw APIError.decodingFailed(error)
            }

        } catch let error as APIError {
            print("[APIClient] API Error: \(error)")
            throw error
        } catch {
            print("[APIClient] Network Error: \(error)")
            throw APIError.networkError(error)
        }
    }

    // MARK: - Upload with Progress

    private func uploadWithProgress(
        request: URLRequest,
        fileURL: URL,
        fileSize: Int64,
        progressHandler: ((UploadProgress) -> Void)?
    ) async throws -> (Data, URLResponse) {
        return try await withCheckedThrowingContinuation { continuation in
            let delegate = UploadDelegate(
                fileSize: fileSize,
                progressHandler: { [weak self] progress in
                    Task { @MainActor in
                        self?.uploadProgress = progress
                        progressHandler?(progress)
                    }
                },
                completion: { result in
                    switch result {
                    case .success(let response):
                        continuation.resume(returning: response)
                    case .failure(let error):
                        continuation.resume(throwing: error)
                    }
                }
            )

            let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
            let task = session.uploadTask(with: request, fromFile: fileURL)
            task.resume()
        }
    }

    // MARK: - URL Building

    private func buildURL(endpoint: String, queryItems: [URLQueryItem] = []) throws -> URL {
        var components = URLComponents(url: configuration.apiURL, resolvingAgainstBaseURL: true)
        components?.path += endpoint

        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }

        guard let url = components?.url else {
            throw APIError.invalidURL
        }

        return url
    }
}

// MARK: - Upload Delegate

private class UploadDelegate: NSObject, URLSessionTaskDelegate, URLSessionDataDelegate {
    private let fileSize: Int64
    private let progressHandler: (UploadProgress) -> Void
    private let completion: (Result<(Data, URLResponse), Error>) -> Void
    private var receivedData = Data()
    private var response: URLResponse?

    init(
        fileSize: Int64,
        progressHandler: @escaping (UploadProgress) -> Void,
        completion: @escaping (Result<(Data, URLResponse), Error>) -> Void
    ) {
        self.fileSize = fileSize
        self.progressHandler = progressHandler
        self.completion = completion
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didSendBodyData bytesSent: Int64,
        totalBytesSent: Int64,
        totalBytesExpectedToSend: Int64
    ) {
        let progress = UploadProgress(
            bytesUploaded: totalBytesSent,
            totalBytes: fileSize
        )
        progressHandler(progress)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        self.response = response
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        receivedData.append(data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            completion(.failure(error))
        } else if let response = response {
            completion(.success((receivedData, response)))
        } else {
            completion(.failure(APIError.noData))
        }
    }
}

// MARK: - Phone API

extension SummaryAIAPIClient {

    /// Send verification code to a phone number
    /// - Parameter phoneNumber: Phone number to verify
    /// - Returns: Response indicating code was sent
    func sendVerificationCode(phoneNumber: String) async throws -> SendVerificationResponse {
        let request = SendVerificationRequest(phoneNumber: phoneNumber)
        return try await post(
            endpoint: "/api/phone/verify/send",
            body: request,
            responseType: SendVerificationResponse.self
        )
    }

    /// Check verification code
    /// - Parameters:
    ///   - phoneNumber: Phone number being verified
    ///   - code: 6-digit verification code
    /// - Returns: Response indicating verification status
    func checkVerificationCode(phoneNumber: String, code: String) async throws -> CheckVerificationResponse {
        let request = CheckVerificationRequest(phoneNumber: phoneNumber, code: code)
        return try await post(
            endpoint: "/api/phone/verify/check",
            body: request,
            responseType: CheckVerificationResponse.self
        )
    }

    /// Get list of verified phone numbers
    /// - Returns: List of verified phones
    func getVerifiedPhones() async throws -> VerifiedPhonesResponse {
        return try await get(
            endpoint: "/api/phone/verified",
            responseType: VerifiedPhonesResponse.self
        )
    }

    /// Delete a verified phone number
    /// - Parameter id: Phone ID to delete
    func deleteVerifiedPhone(id: String) async throws {
        try await delete(endpoint: "/api/phone/verified/\(id)")
    }

    /// Get VoIP access token for Twilio Voice SDK
    /// - Returns: Access token for VoIP calling
    func getVoipToken() async throws -> VoipTokenResponse {
        return try await get(
            endpoint: "/api/phone/voip/token",
            responseType: VoipTokenResponse.self
        )
    }

    /// Initiate a phone call
    /// - Parameters:
    ///   - from: User's verified phone number
    ///   - to: Destination phone number
    ///   - toName: Optional name for the contact
    /// - Returns: Response with call ID and status
    func initiateCall(from: String, to: String, toName: String? = nil) async throws -> InitiateCallResponse {
        let request = InitiateCallRequest(from: from, to: to, toName: toName)
        return try await post(
            endpoint: "/api/phone/calls",
            body: request,
            responseType: InitiateCallResponse.self
        )
    }

    /// Get list of phone calls
    /// - Parameters:
    ///   - limit: Number of calls to fetch
    ///   - offset: Offset for pagination
    /// - Returns: List of phone calls
    func getPhoneCalls(limit: Int = 50, offset: Int = 0) async throws -> ListPhoneCallsResponse {
        let queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "offset", value: String(offset))
        ]
        return try await get(
            endpoint: "/api/phone/calls",
            queryItems: queryItems,
            responseType: ListPhoneCallsResponse.self
        )
    }

    /// Get phone call details
    /// - Parameter id: Call ID
    /// - Returns: Phone call details
    func getPhoneCall(id: String) async throws -> PhoneCallResponse {
        return try await get(
            endpoint: "/api/phone/calls/\(id)",
            responseType: PhoneCallResponse.self
        )
    }

    /// Start recording a phone call
    /// - Parameter callId: Call ID to start recording
    /// - Returns: Recording control response
    func startCallRecording(callId: String) async throws -> RecordingControlResponse {
        return try await post(
            endpoint: "/api/phone/calls/\(callId)/record",
            body: EmptyRequest(),
            responseType: RecordingControlResponse.self
        )
    }

    /// Stop recording a phone call
    /// - Parameter callId: Call ID to stop recording
    /// - Returns: Recording control response
    func stopCallRecording(callId: String) async throws -> RecordingControlResponse {
        // Using a custom delete that returns a response
        let url = try buildURL(endpoint: "/api/phone/calls/\(callId)/record")
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        return try await performRequest(request, responseType: RecordingControlResponse.self)
    }

    /// Hang up a phone call
    /// - Parameter callId: Call ID to hang up
    /// - Returns: Hangup response
    func hangupCall(callId: String) async throws -> HangupResponse {
        return try await post(
            endpoint: "/api/phone/calls/\(callId)/hangup",
            body: EmptyRequest(),
            responseType: HangupResponse.self
        )
    }

    // Helper to build URL (exposing for extension use)
    func buildURL(endpoint: String) throws -> URL {
        var components = URLComponents(url: configuration.apiURL, resolvingAgainstBaseURL: true)
        components?.path += endpoint

        guard let url = components?.url else {
            throw APIError.invalidURL
        }

        return url
    }

    // Helper to perform request (exposing for extension use)
    // This now delegates to the private performRequest which handles token refresh
    func performRequest<T: Decodable>(
        _ request: URLRequest,
        responseType: T.Type
    ) async throws -> T {
        return try await performRequest(request, responseType: responseType, allowEmpty: false, isRetry: false)
    }
}

/// MARK: - Empty Types

private struct EmptyResponse: Decodable {}
private struct EmptyRequest: Encodable {}
