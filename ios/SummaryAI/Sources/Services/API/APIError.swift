import Foundation

// MARK: - API Error

/// Errors that can occur during API operations
enum APIError: Error, LocalizedError {
    case invalidURL
    case noData
    case decodingFailed(Error)
    case encodingFailed(Error)
    case networkError(Error)
    case httpError(statusCode: Int, message: String?)
    case unauthorized
    case forbidden
    case notFound
    case serverError(message: String?)
    case uploadFailed(Error)
    case noAccessToken
    case fileError(String)
    case consentRequired
    case unknown(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .noData:
            return "No data received from server"
        case .decodingFailed(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .encodingFailed(let error):
            return "Failed to encode request: \(error.localizedDescription)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .httpError(let statusCode, let message):
            return "HTTP error \(statusCode): \(message ?? "Unknown error")"
        case .unauthorized:
            return "Authentication required. Please log in again."
        case .forbidden:
            return "You don't have permission to access this resource."
        case .notFound:
            return "The requested resource was not found."
        case .serverError(let message):
            return "Server error: \(message ?? "Please try again later.")"
        case .uploadFailed(let error):
            return "Upload failed: \(error.localizedDescription)"
        case .noAccessToken:
            return "No access token available. Please log in."
        case .fileError(let message):
            return "File error: \(message)"
        case .consentRequired:
            return "AI data sharing consent is required. Please grant consent in Settings > Data & Privacy."
        case .unknown(let error):
            return "An unexpected error occurred: \(error.localizedDescription)"
        }
    }

    /// Whether this error suggests the user should retry
    var isRetryable: Bool {
        switch self {
        case .networkError, .serverError:
            return true
        case .httpError(let statusCode, _):
            return statusCode >= 500
        default:
            return false
        }
    }

    /// Whether this error requires re-authentication
    var requiresReauth: Bool {
        switch self {
        case .unauthorized, .noAccessToken:
            return true
        default:
            return false
        }
    }

    /// User-friendly message for display
    var userMessage: String {
        errorDescription ?? "An unexpected error occurred"
    }
}
