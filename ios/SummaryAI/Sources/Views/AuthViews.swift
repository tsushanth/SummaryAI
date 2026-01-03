import SwiftUI
import AuthenticationServices

// MARK: - Auth Container View

/// Container view that handles authentication flow
struct AuthContainerView: View {
    @EnvironmentObject var authService: AuthService

    var body: some View {
        Group {
            switch authService.state {
            case .unknown:
                LoadingView()

            case .unauthenticated, .authenticating:
                SignInView()

            case .authenticated:
                MainTabView()
            }
        }
        .animation(.default, value: authService.state.isAuthenticated)
    }
}

// MARK: - Loading View

struct LoadingView: View {
    var body: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.5)

            Text("Loading...")
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Sign In View

struct SignInView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.colorScheme) private var colorScheme
    @State private var errorMessage: String?
    @State private var showError = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Logo and title
            VStack(spacing: 16) {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.linearGradient(
                        colors: [.blue, .purple],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))

                Text("Meeting Mind")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Record, transcribe, and summarize\nyour meetings with AI")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()

            // Sign in buttons
            VStack(spacing: 16) {
                // Sign in with Apple - adapts to color scheme
                SignInWithAppleButton(
                    onRequest: { request in
                        request.requestedScopes = [.fullName, .email]
                    },
                    onCompletion: { _ in
                        // Handled by AuthService
                    }
                )
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(height: 50)
                .cornerRadius(12)
                .onTapGesture {
                    Task {
                        do {
                            try await authService.signInWithApple()
                        } catch AuthError.cancelled {
                            // User cancelled, ignore
                        } catch {
                            errorMessage = error.localizedDescription
                            showError = true
                        }
                    }
                }

                // Sign in with Google - adapts to color scheme
                Button {
                    Task {
                        do {
                            try await authService.signInWithGoogle()
                        } catch AuthError.cancelled {
                            // User cancelled, ignore
                        } catch {
                            errorMessage = error.localizedDescription
                            showError = true
                        }
                    }
                } label: {
                    HStack(spacing: 12) {
                        // Google "G" logo using colored circles
                        GoogleLogoView()
                            .frame(width: 20, height: 20)

                        Text("Sign in with Google")
                            .fontWeight(.medium)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(colorScheme == .dark ? Color.white : Color.white)
                    .foregroundColor(.black)
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(colorScheme == .dark ? Color.clear : Color.gray.opacity(0.3), lineWidth: 1)
                    )
                }

                // Privacy notice
                VStack(spacing: 4) {
                    Text("By signing in, you agree to our")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack(spacing: 4) {
                        Link("Terms of Service", destination: URL(string: "https://kreativekoala.llc/terms")!)
                        Text("and")
                            .foregroundColor(.secondary)
                        Link("Privacy Policy", destination: URL(string: "https://kreativekoala.llc/privacy")!)
                    }
                    .font(.caption)
                }
                .padding(.top, 8)
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 40)
        }
        .alert("Sign In Error", isPresented: $showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "An error occurred")
        }
        .overlay {
            if authService.isLoading {
                Color.black.opacity(0.3)
                    .ignoresSafeArea()
                ProgressView()
                    .scaleEffect(1.5)
                    .tint(.white)
            }
        }
    }
}

// MARK: - Email Sign In View

struct EmailSignInView: View {
    @EnvironmentObject var authService: AuthService
    @Environment(\.dismiss) private var dismiss

    @State private var isSignUp = false
    @State private var email = ""
    @State private var password = ""
    @State private var fullName = ""
    @State private var errorMessage: String?
    @State private var showError = false

    private var isFormValid: Bool {
        let emailValid = email.contains("@") && email.contains(".")
        let passwordValid = password.count >= 8

        if isSignUp {
            return emailValid && passwordValid && !fullName.isEmpty
        }
        return emailValid && passwordValid
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if isSignUp {
                        TextField("Full Name", text: $fullName)
                            .textContentType(.name)
                            .autocorrectionDisabled()
                    }

                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()

                    SecureField("Password", text: $password)
                        .textContentType(isSignUp ? .newPassword : .password)
                }

                Section {
                    Button {
                        Task { await signIn() }
                    } label: {
                        HStack {
                            Spacer()
                            if authService.isLoading {
                                ProgressView()
                            } else {
                                Text(isSignUp ? "Create Account" : "Sign In")
                                    .fontWeight(.semibold)
                            }
                            Spacer()
                        }
                    }
                    .disabled(!isFormValid || authService.isLoading)
                }

                Section {
                    Button {
                        withAnimation {
                            isSignUp.toggle()
                        }
                    } label: {
                        Text(isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up")
                            .font(.subheadline)
                    }
                }
            }
            .navigationTitle(isSignUp ? "Create Account" : "Sign In")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert("Error", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "An error occurred")
            }
        }
    }

    private func signIn() async {
        do {
            if isSignUp {
                try await authService.signUp(email: email, password: password, fullName: fullName)
            } else {
                try await authService.signIn(email: email, password: password)
            }
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }
}

// MARK: - Google Logo View

/// Custom Google "G" logo using SwiftUI shapes
struct GoogleLogoView: View {
    var body: some View {
        GeometryReader { geometry in
            let size = min(geometry.size.width, geometry.size.height)

            ZStack {
                // Blue segment (right side)
                Circle()
                    .trim(from: 0.0, to: 0.25)
                    .stroke(Color(red: 66/255, green: 133/255, blue: 244/255), lineWidth: size * 0.2)
                    .rotationEffect(.degrees(-45))

                // Green segment (bottom)
                Circle()
                    .trim(from: 0.0, to: 0.25)
                    .stroke(Color(red: 52/255, green: 168/255, blue: 83/255), lineWidth: size * 0.2)
                    .rotationEffect(.degrees(45))

                // Yellow segment (left-bottom)
                Circle()
                    .trim(from: 0.0, to: 0.25)
                    .stroke(Color(red: 251/255, green: 188/255, blue: 5/255), lineWidth: size * 0.2)
                    .rotationEffect(.degrees(135))

                // Red segment (top)
                Circle()
                    .trim(from: 0.0, to: 0.25)
                    .stroke(Color(red: 234/255, green: 67/255, blue: 53/255), lineWidth: size * 0.2)
                    .rotationEffect(.degrees(225))

                // Blue horizontal bar
                Rectangle()
                    .fill(Color(red: 66/255, green: 133/255, blue: 244/255))
                    .frame(width: size * 0.5, height: size * 0.2)
                    .offset(x: size * 0.15)
            }
            .frame(width: size, height: size)
        }
    }
}

// MARK: - Preview

#if DEBUG
struct SignInView_Previews: PreviewProvider {
    static var previews: some View {
        SignInView()
            .environmentObject(AuthService())
    }
}
#endif
