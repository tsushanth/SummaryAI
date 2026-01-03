import Foundation
import AuthenticationServices
import CryptoKit
import GoogleSignIn

// MARK: - Auth State

/// Authentication state
enum AuthState: Equatable {
    case unknown
    case unauthenticated
    case authenticating
    case authenticated(User)

    var isAuthenticated: Bool {
        if case .authenticated = self { return true }
        return false
    }

    var user: User? {
        if case .authenticated(let user) = self { return user }
        return nil
    }
}

// MARK: - User Model

/// Authenticated user
struct User: Codable, Equatable {
    let id: String
    let email: String
    let fullName: String?
    let avatarURL: String?
    let provider: AuthProvider
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case fullName = "full_name"
        case avatarURL = "avatar_url"
        case provider
        case createdAt = "created_at"
    }
}

/// Authentication provider
enum AuthProvider: String, Codable {
    case apple
    case google
    case email
}

// MARK: - Auth Error

enum AuthError: Error, LocalizedError {
    case notConfigured
    case invalidCredentials
    case networkError(Error)
    case serverError(String)
    case cancelled
    case unknown

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Authentication is not configured"
        case .invalidCredentials:
            return "Invalid credentials"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .serverError(let message):
            return message
        case .cancelled:
            return "Authentication was cancelled"
        case .unknown:
            return "An unknown error occurred"
        }
    }
}

// MARK: - Auth Service

/// Service for handling authentication with Supabase
@MainActor
final class AuthService: NSObject, ObservableObject {

    // MARK: - Published Properties

    @Published private(set) var state: AuthState = .unknown
    @Published private(set) var isLoading = false

    // MARK: - Properties

    private var currentNonce: String?

    /// Supabase configuration
    private let supabaseURL: String
    private let supabaseAnonKey: String

    /// Google Sign-In configuration
    private let googleClientID: String
    private let googleServerClientID: String  // Web Client ID for Supabase

    // MARK: - Session Storage Keys

    private let accessTokenKey = "supabase_access_token"
    private let refreshTokenKey = "supabase_refresh_token"
    private let userKey = "supabase_user"

    // MARK: - Initialization

    // Default configuration values
    private static let defaultSupabaseURL = "https://mlofjzlmncgnhxbiuemf.supabase.co"
    private static let defaultSupabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sb2ZqemxtbmNnbmh4Yml1ZW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyOTU1NjAsImV4cCI6MjA4Mjg3MTU2MH0.fUxgMcu1BNrsYneN5vSMFWxsv-rWIygCx-xn-Vmr0Ec"
    private static let defaultGoogleClientID = "655434901651-fnqoakiv9cnmp12julsrh8iim63oppl9.apps.googleusercontent.com"
    private static let defaultGoogleServerClientID = "655434901651-1pu8uh26nq64dj1hujuoipfm84537ism.apps.googleusercontent.com"  // Web Client ID

    init(
        supabaseURL: String = AuthService.defaultSupabaseURL,
        supabaseAnonKey: String = AuthService.defaultSupabaseAnonKey,
        googleClientID: String = AuthService.defaultGoogleClientID,
        googleServerClientID: String = AuthService.defaultGoogleServerClientID
    ) {
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey
        self.googleClientID = googleClientID
        self.googleServerClientID = googleServerClientID
        super.init()

        // Check for existing session
        Task {
            await checkSession()
        }
    }

    // MARK: - Session Management

    /// Check for existing session
    func checkSession() async {
        // Try to load stored session
        if let userData = UserDefaults.standard.data(forKey: userKey),
           let user = try? JSONDecoder().decode(User.self, from: userData),
           let accessToken = getStoredAccessToken() {

            // Validate token is not expired
            if isTokenValid(accessToken) {
                state = .authenticated(user)
                return
            } else {
                // Try to refresh
                do {
                    try await refreshSession()
                    return
                } catch {
                    // Refresh failed, clear session
                    clearSession()
                }
            }
        }

        state = .unauthenticated
    }

    /// Refresh the current session
    func refreshSession() async throws {
        guard let refreshToken = UserDefaults.standard.string(forKey: refreshTokenKey) else {
            throw AuthError.invalidCredentials
        }

        // Call Supabase refresh endpoint
        // This is a simplified implementation - use Supabase SDK in production
        let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=refresh_token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "apikey")

        let body = ["refresh_token": refreshToken]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AuthError.serverError("Failed to refresh session")
        }

        // Parse and store new tokens
        let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)
        storeSession(accessToken: tokenResponse.accessToken, refreshToken: tokenResponse.refreshToken)
    }

    /// Get current access token for API calls
    func getAccessToken() async -> String? {
        let storedToken = getStoredAccessToken()
        print("getAccessToken called - Has stored token: \(storedToken != nil)")

        // Check if token needs refresh
        if let token = storedToken {
            if !isTokenValid(token) {
                print("Token expired, attempting refresh...")
                try? await refreshSession()
            }
            return getStoredAccessToken()
        }

        print("No access token available")
        return nil
    }

    // MARK: - Sign In with Apple

    /// Start Sign in with Apple flow
    func signInWithApple() async throws {
        isLoading = true
        state = .authenticating

        defer { isLoading = false }

        // Generate nonce for security
        let nonce = generateNonce()
        currentNonce = nonce

        // Create Apple ID request
        let appleIDProvider = ASAuthorizationAppleIDProvider()
        let request = appleIDProvider.createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = sha256(nonce)

        // Perform authorization
        let authorization = try await performAppleAuthorization(request: request)

        guard let appleIDCredential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let identityToken = appleIDCredential.identityToken,
              let idTokenString = String(data: identityToken, encoding: .utf8) else {
            state = .unauthenticated
            throw AuthError.invalidCredentials
        }

        // Exchange Apple token with Supabase
        try await exchangeAppleToken(idToken: idTokenString, nonce: nonce, credential: appleIDCredential)
    }

    private func performAppleAuthorization(request: ASAuthorizationAppleIDRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            let controller = ASAuthorizationController(authorizationRequests: [request])
            let delegate = AppleSignInDelegate(continuation: continuation)
            controller.delegate = delegate
            controller.presentationContextProvider = delegate

            // Hold reference to delegate
            objc_setAssociatedObject(controller, "delegate", delegate, .OBJC_ASSOCIATION_RETAIN)

            controller.performRequests()
        }
    }

    private func exchangeAppleToken(idToken: String, nonce: String, credential: ASAuthorizationAppleIDCredential) async throws {
        let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=id_token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        var body: [String: Any] = [
            "provider": "apple",
            "id_token": idToken,
            "nonce": nonce
        ]

        // Include name if provided (only on first sign-in)
        if let fullName = credential.fullName {
            let name = [fullName.givenName, fullName.familyName]
                .compactMap { $0 }
                .joined(separator: " ")
            if !name.isEmpty {
                body["options"] = ["data": ["full_name": name]]
            }
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            state = .unauthenticated
            throw AuthError.networkError(NSError(domain: "Auth", code: -1))
        }

        guard httpResponse.statusCode == 200 else {
            state = .unauthenticated
            let errorMessage = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw AuthError.serverError(errorMessage)
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        handleAuthResponse(authResponse, provider: .apple)
    }

    // MARK: - Sign In with Google

    /// Start Sign in with Google flow
    func signInWithGoogle() async throws {
        isLoading = true
        state = .authenticating

        defer { isLoading = false }

        // Get the presenting view controller
        guard let windowScene = await UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let rootViewController = await windowScene.windows.first?.rootViewController else {
            state = .unauthenticated
            throw AuthError.unknown
        }

        // Configure Google Sign-In with iOS client ID and server (web) client ID
        // The serverClientID ensures the ID token has the correct audience for Supabase
        let config = GIDConfiguration(
            clientID: googleClientID,
            serverClientID: googleServerClientID
        )
        GIDSignIn.sharedInstance.configuration = config

        do {
            let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: rootViewController)

            guard let idToken = result.user.idToken?.tokenString else {
                state = .unauthenticated
                throw AuthError.invalidCredentials
            }

            // Exchange Google token with Supabase
            try await exchangeGoogleToken(idToken: idToken, user: result.user)

        } catch let error as GIDSignInError {
            state = .unauthenticated
            if error.code == .canceled {
                throw AuthError.cancelled
            }
            throw AuthError.networkError(error)
        } catch {
            state = .unauthenticated
            throw error
        }
    }

    private func exchangeGoogleToken(idToken: String, user: GIDGoogleUser) async throws {
        let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=id_token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        var body: [String: Any] = [
            "provider": "google",
            "id_token": idToken
        ]

        // Include user info from Google
        let fullName = user.profile?.name ?? ""
        if !fullName.isEmpty {
            body["options"] = ["data": ["full_name": fullName, "avatar_url": user.profile?.imageURL(withDimension: 200)?.absoluteString ?? ""]]
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            state = .unauthenticated
            throw AuthError.networkError(NSError(domain: "Auth", code: -1))
        }

        guard httpResponse.statusCode == 200 else {
            state = .unauthenticated
            let errorMessage = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw AuthError.serverError(errorMessage)
        }

        do {
            let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
            handleAuthResponse(authResponse, provider: .google)
        } catch {
            // Log the actual response for debugging
            let responseString = String(data: data, encoding: .utf8) ?? "Unable to decode response"
            print("Google Sign-In response decoding error: \(error)")
            print("Response data: \(responseString)")
            throw AuthError.serverError("Failed to parse auth response: \(error.localizedDescription)")
        }
    }

    // MARK: - Sign In with Email

    /// Sign in with email and password
    func signIn(email: String, password: String) async throws {
        isLoading = true
        state = .authenticating

        defer { isLoading = false }

        let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=password")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        let body = ["email": email, "password": password]
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            state = .unauthenticated
            throw AuthError.networkError(NSError(domain: "Auth", code: -1))
        }

        guard httpResponse.statusCode == 200 else {
            state = .unauthenticated
            throw AuthError.invalidCredentials
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        handleAuthResponse(authResponse, provider: .email)
    }

    /// Sign up with email and password
    func signUp(email: String, password: String, fullName: String?) async throws {
        isLoading = true
        state = .authenticating

        defer { isLoading = false }

        let url = URL(string: "\(supabaseURL)/auth/v1/signup")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        var body: [String: Any] = ["email": email, "password": password]
        if let name = fullName, !name.isEmpty {
            body["options"] = ["data": ["full_name": name]]
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            state = .unauthenticated
            throw AuthError.networkError(NSError(domain: "Auth", code: -1))
        }

        guard httpResponse.statusCode == 200 else {
            state = .unauthenticated
            let errorMessage = String(data: data, encoding: .utf8) ?? "Sign up failed"
            throw AuthError.serverError(errorMessage)
        }

        let authResponse = try JSONDecoder().decode(AuthResponse.self, from: data)
        handleAuthResponse(authResponse, provider: .email)
    }

    // MARK: - Sign Out

    /// Sign out current user
    func signOut() async {
        // Call Supabase sign out
        if let accessToken = getStoredAccessToken() {
            let url = URL(string: "\(supabaseURL)/auth/v1/logout")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
            request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

            _ = try? await URLSession.shared.data(for: request)
        }

        clearSession()
        state = .unauthenticated
    }

    // MARK: - Delete Account

    /// Delete the current user's account and all associated data
    func deleteAccount() async throws {
        guard let accessToken = getStoredAccessToken() else {
            throw AuthError.invalidCredentials
        }

        isLoading = true
        defer { isLoading = false }

        // Call the backend to delete the user account
        // This will delete all user data (recordings, meetings, etc.) and then the auth user
        let url = URL(string: "\(supabaseURL)/auth/v1/user")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.networkError(NSError(domain: "Auth", code: -1))
        }

        // Supabase returns 200 on successful deletion
        guard httpResponse.statusCode == 200 || httpResponse.statusCode == 204 else {
            let errorMessage = String(data: data, encoding: .utf8) ?? "Failed to delete account"
            throw AuthError.serverError(errorMessage)
        }

        // Clear local session
        clearSession()
        state = .unauthenticated
    }

    // MARK: - Session Storage

    private func handleAuthResponse(_ response: AuthResponse, provider: AuthProvider) {
        let user = User(
            id: response.user.id,
            email: response.user.emailValue,
            fullName: response.user.userMetadata?.fullName,
            avatarURL: response.user.userMetadata?.avatarURL,
            provider: provider,
            createdAt: response.user.createdAtDate
        )

        // Store tokens
        storeSession(accessToken: response.accessToken, refreshToken: response.refreshToken)

        // Store user
        if let userData = try? JSONEncoder().encode(user) {
            UserDefaults.standard.set(userData, forKey: userKey)
        }

        state = .authenticated(user)
    }

    private func storeSession(accessToken: String, refreshToken: String) {
        // In production, use Keychain instead of UserDefaults for tokens
        UserDefaults.standard.set(accessToken, forKey: accessTokenKey)
        UserDefaults.standard.set(refreshToken, forKey: refreshTokenKey)
        UserDefaults.standard.synchronize()
        print("Session stored - Access token length: \(accessToken.count), Refresh token length: \(refreshToken.count)")
    }

    private func getStoredAccessToken() -> String? {
        UserDefaults.standard.string(forKey: accessTokenKey)
    }

    private func clearSession() {
        UserDefaults.standard.removeObject(forKey: accessTokenKey)
        UserDefaults.standard.removeObject(forKey: refreshTokenKey)
        UserDefaults.standard.removeObject(forKey: userKey)
    }

    private func isTokenValid(_ token: String) -> Bool {
        // Decode JWT and check expiration
        // This is a simplified check - implement proper JWT validation
        let parts = token.split(separator: ".")
        guard parts.count == 3,
              let payloadData = Data(base64Encoded: String(parts[1]).base64Padded()) else {
            return false
        }

        guard let payload = try? JSONDecoder().decode(JWTPayload.self, from: payloadData) else {
            return false
        }

        // Check if token expires in more than 60 seconds
        return payload.exp > Date().timeIntervalSince1970 + 60
    }

    // MARK: - Crypto Helpers

    private func generateNonce(length: Int = 32) -> String {
        let charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._"
        var result = ""
        var remainingLength = length

        while remainingLength > 0 {
            let randoms: [UInt8] = (0..<16).map { _ in
                var random: UInt8 = 0
                _ = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
                return random
            }

            randoms.forEach { random in
                if remainingLength == 0 { return }
                if random < charset.count {
                    result.append(charset[charset.index(charset.startIndex, offsetBy: Int(random))])
                    remainingLength -= 1
                }
            }
        }

        return result
    }

    private func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashedData = SHA256.hash(data: inputData)
        return hashedData.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Apple Sign In Delegate

private class AppleSignInDelegate: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    let continuation: CheckedContinuation<ASAuthorization, Error>

    init(continuation: CheckedContinuation<ASAuthorization, Error>) {
        self.continuation = continuation
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        continuation.resume(returning: authorization)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            continuation.resume(throwing: AuthError.cancelled)
        } else {
            continuation.resume(throwing: AuthError.networkError(error))
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // Get the key window
        guard let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let window = scene.windows.first else {
            fatalError("No window found")
        }
        return window
    }
}

// MARK: - Response Models

private struct AuthResponse: Decodable {
    let accessToken: String
    let refreshToken: String
    let user: AuthUser
    let tokenType: String?
    let expiresIn: Int?
    let expiresAt: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case user
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case expiresAt = "expires_at"
    }
}

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

private struct AuthUser: Decodable {
    let id: String
    let email: String?
    let userMetadata: UserMetadata?
    let createdAt: String  // Keep as String to avoid date parsing issues

    enum CodingKeys: String, CodingKey {
        case id
        case email
        case userMetadata = "user_metadata"
        case createdAt = "created_at"
    }

    var emailValue: String {
        email ?? ""
    }

    var createdAtDate: Date {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: createdAt) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: createdAt) {
            return date
        }
        return Date()
    }
}

private struct UserMetadata: Decodable {
    let fullName: String?
    let avatarURL: String?

    enum CodingKeys: String, CodingKey {
        case fullName = "full_name"
        case avatarURL = "avatar_url"
    }
}

private struct JWTPayload: Decodable {
    let exp: TimeInterval
}

// MARK: - String Extension

private extension String {
    func base64Padded() -> String {
        let remainder = count % 4
        if remainder == 0 { return self }
        return self + String(repeating: "=", count: 4 - remainder)
    }
}
