import Foundation

// MARK: - API Configuration

/// Configuration for the API client
struct APIConfiguration {
    let baseURL: URL
    let apiVersion: String

    var apiURL: URL {
        baseURL.appendingPathComponent(apiVersion)
    }

    static let production = APIConfiguration(
        baseURL: URL(string: "https://api.summaryai.app")!,
        apiVersion: "v1"
    )

    static let staging = APIConfiguration(
        baseURL: URL(string: "https://api-staging.summaryai.app")!,
        apiVersion: "v1"
    )

    static let development = APIConfiguration(
        baseURL: URL(string: "http://localhost:8080")!,
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

    // MARK: - Upload State

    private var uploadTask: URLSessionUploadTask?
    private var uploadContinuation: CheckedContinuation<Void, Error>?

    // MARK: - Initialization

    init(configuration: APIConfiguration = .development) {
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
        fileSize: Int64
    ) async throws -> CreateRecordingResponse {
        let request = CreateRecordingRequest(
            title: title,
            durationSeconds: duration,
            fileSizeBytes: fileSize,
            contentType: "audio/mp4"
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

    /// Full upload flow: create → upload → complete
    /// - Parameters:
    ///   - title: Recording title
    ///   - fileURL: Local audio file URL
    ///   - duration: Recording duration in seconds
    ///   - progressHandler: Optional progress callback
    /// - Returns: The completed recording
    func uploadRecording(
        title: String,
        fileURL: URL,
        duration: TimeInterval,
        progressHandler: ((UploadProgress) -> Void)? = nil
    ) async throws -> Recording {
        // Get file size
        let fileAttributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let fileSize = fileAttributes[.size] as? Int64 ?? 0

        print("[APIClient] Starting upload flow for '\(title)' (\(fileSize) bytes)")

        // Step 1: Create recording and get upload URL
        let createResponse = try await createRecording(
            title: title,
            duration: Int(duration),
            fileSize: fileSize
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

        print("[APIClient] Upload complete. Job ID: \(completeResponse.job.id)")

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

    private func delete(endpoint: String) async throws {
        let url = try buildURL(endpoint: endpoint)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        let _: EmptyResponse = try await performRequest(request, responseType: EmptyResponse.self, allowEmpty: true)
    }

    // MARK: - Request Execution

    private func performRequest<T: Decodable>(
        _ request: URLRequest,
        responseType: T.Type,
        allowEmpty: Bool = false
    ) async throws -> T {
        var request = request

        // Add auth header
        if let token = await accessTokenProvider?() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        } else {
            throw APIError.noAccessToken
        }

        // Add common headers
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.networkError(NSError(domain: "API", code: -1, userInfo: nil))
            }

            // Handle HTTP errors
            switch httpResponse.statusCode {
            case 200...299:
                break
            case 401:
                throw APIError.unauthorized
            case 403:
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
            throw error
        } catch {
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

// MARK: - Empty Response

private struct EmptyResponse: Decodable {}
