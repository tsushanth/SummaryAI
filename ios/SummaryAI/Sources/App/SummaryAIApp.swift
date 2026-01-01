import SwiftUI

// MARK: - App Entry Point

@main
struct SummaryAIApp: App {
    @StateObject private var authService = AuthService()
    @StateObject private var apiClient = SummaryAIAPIClient()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authService)
                .environmentObject(apiClient)
                .onAppear {
                    // Connect auth service to API client
                    apiClient.accessTokenProvider = {
                        await authService.getAccessToken()
                    }
                }
        }
    }
}

// MARK: - Root View

/// Root view that handles auth state and routing
struct RootView: View {
    @EnvironmentObject var authService: AuthService

    var body: some View {
        Group {
            switch authService.state {
            case .unknown:
                SplashView()

            case .unauthenticated, .authenticating:
                SignInView()

            case .authenticated:
                MainTabView()
            }
        }
        .animation(.easeInOut(duration: 0.3), value: authService.state.isAuthenticated)
    }
}

// MARK: - Splash View

/// Splash screen shown while checking auth state
struct SplashView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(.linearGradient(
                    colors: [.blue, .purple],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ))

            Text("Summary AI")
                .font(.title)
                .fontWeight(.bold)

            ProgressView()
                .padding(.top, 20)
        }
    }
}

// MARK: - Main Tab View

/// Main tab-based navigation for authenticated users
struct MainTabView: View {
    @State private var selectedTab: AppTab = .recordings

    var body: some View {
        TabView(selection: $selectedTab) {
            RecordingsListView()
                .searchableRecordings()
                .tabItem {
                    Label("Recordings", systemImage: "list.bullet")
                }
                .tag(AppTab.recordings)

            NavigationStack {
                RecordingView()
            }
            .tabItem {
                Label("Record", systemImage: "mic.fill")
            }
            .tag(AppTab.record)

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(AppTab.settings)
        }
    }
}

// MARK: - App Tab

enum AppTab: Hashable {
    case recordings
    case record
    case settings
}
