import SwiftUI
import UserNotifications
import GoogleSignIn
import FirebaseCore
import FacebookCore

// MARK: - App Entry Point

@main
struct SummaryAIApp: App {
    @StateObject private var authService = AuthService()
    @StateObject private var apiClient = SummaryAIAPIClient()
    @StateObject private var subscriptionService = SubscriptionService()

    init() {
        // Configure Firebase for analytics and attribution tracking
        FirebaseApp.configure()
        AnalyticsService.configure()

        // Configure RevenueCat for in-app purchases and attribution tracking
        SubscriptionService.configure()

        // Track Apple Search Ads attribution for ASA bid optimization
        AttributionService.shared.trackAttribution()
        // Initialize Facebook SDK for Meta Ads attribution and CAPI
        ApplicationDelegate.shared.application(
            UIApplication.shared,
            didFinishLaunchingWithOptions: nil
        )

        // Initialize TikTok Events SDK for install attribution
        TikTokHelper.shared.initialize()
        TikTokHelper.shared.requestTrackingPermission()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(authService)
                .environmentObject(apiClient)
                .environmentObject(subscriptionService)
                .onAppear {
                    // Connect auth service to API client
                    apiClient.accessTokenProvider = {
                        await authService.getAccessToken()
                    }
                    // Set up token refresh handler for automatic retry on 401
                    apiClient.tokenRefreshHandler = {
                        try await authService.refreshSession()
                    }
                }
                .onOpenURL { url in
                    // Handle Google Sign-In callback
                    GIDSignIn.sharedInstance.handle(url)

                    // Handle Facebook URL callback for deep linking
                    ApplicationDelegate.shared.application(
                        UIApplication.shared,
                        open: url,
                        sourceApplication: nil,
                        annotation: UIApplication.OpenURLOptionsKey.annotation
                    )
                }
        }
    }
}

// MARK: - Root View

/// Root view that handles auth state and routing
struct RootView: View {
    @EnvironmentObject var authService: AuthService
    @EnvironmentObject var subscriptionService: SubscriptionService
    @StateObject private var consentManager = AIDataConsentManager.shared
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @AppStorage("hasSeenPaywall") private var hasSeenPaywall = false

    var body: some View {
        Group {
            switch authService.state {
            case .unknown:
                SplashView()

            case .unauthenticated, .authenticating:
                if !hasCompletedOnboarding {
                    OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                } else if consentManager.needsConsent {
                    AIDataConsentView(isOnboarding: true)
                } else {
                    SignInView()
                        .fullScreenCover(isPresented: .constant(!hasSeenPaywall)) {
                            RemotePaywallView(triggerSource: "onboarding")
                                .onDisappear { hasSeenPaywall = true }
                        }
                }

            case .authenticated:
                if consentManager.needsConsent {
                    AIDataConsentView(isOnboarding: true)
                } else {
                    MainTabView()
                }
            }
        }
        .animation(.easeInOut(duration: 0.3), value: authService.state.isAuthenticated)
        .animation(.easeInOut(duration: 0.3), value: hasCompletedOnboarding)
        .animation(.easeInOut(duration: 0.3), value: hasSeenPaywall)
        .animation(.easeInOut(duration: 0.3), value: consentManager.hasConsented)
        .onChange(of: authService.state) { oldState, newState in
            // Link RevenueCat user ID when user authenticates
            if case .authenticated(let user) = newState {
                Task {
                    await subscriptionService.loginUser(userId: user.id)
                }
                // Set analytics user ID
                AnalyticsService.shared.setUserId(user.id)
                AnalyticsService.shared.logSignInCompleted(method: "google")
            }
            // Logout from RevenueCat when user signs out
            if case .authenticated = oldState, case .unauthenticated = newState {
                Task {
                    await subscriptionService.logoutUser()
                }
                // Clear analytics user ID
                AnalyticsService.shared.setUserId(nil)
                AnalyticsService.shared.logSignOut()
            }
        }
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

            Text("Meeting Mind")
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
    @EnvironmentObject var apiClient: SummaryAIAPIClient
    @State private var selectedTab: AppTab = .recordings
    @StateObject private var calendarViewModel: CalendarViewModel

    init() {
        // Initialize with a temporary apiClient - will be replaced by environment
        _calendarViewModel = StateObject(wrappedValue: CalendarViewModel(apiClient: SummaryAIAPIClient()))
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            RecordingsListView()
                .searchableRecordings()
                .tabItem {
                    Label("Recordings", systemImage: "list.bullet")
                }
                .tag(AppTab.recordings)

            NavigationStack {
                MeetingsView(viewModel: calendarViewModel)
                    .navigationTitle("Calendar")
            }
            .tabItem {
                Label("Calendar", systemImage: "calendar")
            }
            .tag(AppTab.calendar)

            NavigationStack {
                RecordingView()
            }
            .tabItem {
                Label("Record", systemImage: "mic.fill")
            }
            .tag(AppTab.record)

            PhoneView()
            .tabItem {
                Label("Phone", systemImage: "phone.fill")
            }
            .tag(AppTab.phone)

            SettingsView(calendarViewModel: calendarViewModel)
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
                .tag(AppTab.settings)
        }
        .onAppear {
            // Update the view models to use the correct API client
            calendarViewModel.updateApiClient(apiClient)
            Task {
                await calendarViewModel.loadConnections()
                if calendarViewModel.hasConnectedCalendars {
                    await calendarViewModel.loadMeetings()
                }
            }
        }
        .reviewPrompt()
    }
}

// MARK: - App Tab

enum AppTab: Hashable {
    case recordings
    case calendar
    case record
    case phone
    case settings
}

// MARK: - Onboarding View

/// Multi-step onboarding flow for new users
struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool
    @State private var currentPage = 0
    @State private var showNotificationPrompt = false

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            title: "Tap Record",
            subtitle: "and get accurate word-for-word transcripts",
            systemImage: "waveform.circle.fill",
            features: [
                OnboardingFeature(icon: "person.2.fill", text: "Speaker identification", color: .blue),
                OnboardingFeature(icon: "clock.fill", text: "Timestamps for every segment", color: .green),
                OnboardingFeature(icon: "globe", text: "120+ languages supported", color: .purple)
            ],
            gradient: [.blue, .cyan]
        ),
        OnboardingPage(
            title: "Perfect Notes",
            subtitle: "Ready to Share",
            systemImage: "doc.text.fill",
            features: [
                OnboardingFeature(icon: "text.alignleft", text: "AI-powered summaries", color: .orange),
                OnboardingFeature(icon: "checklist", text: "Action items extracted", color: .green),
                OnboardingFeature(icon: "bubble.left.and.bubble.right.fill", text: "Ask questions about recordings", color: .blue)
            ],
            gradient: [.purple, .pink]
        ),
        OnboardingPage(
            title: "Customize,",
            subtitle: "Export, Share",
            systemImage: "square.and.arrow.up.fill",
            features: [
                OnboardingFeature(icon: "doc.richtext", text: "Export as PDF or Text", color: .red),
                OnboardingFeature(icon: "envelope.fill", text: "Share via email or messages", color: .blue),
                OnboardingFeature(icon: "folder.fill", text: "Organize with folders", color: .orange)
            ],
            gradient: [.orange, .red]
        ),
        OnboardingPage(
            title: "Built with Data Privacy",
            subtitle: "at the Core",
            systemImage: "lock.shield.fill",
            features: [
                OnboardingFeature(icon: "icloud.and.arrow.up", text: "Secure cloud storage", color: .blue),
                OnboardingFeature(icon: "hand.raised.fill", text: "Your data stays private", color: .green),
                OnboardingFeature(icon: "key.fill", text: "End-to-end encryption", color: .purple)
            ],
            gradient: [.blue, .indigo]
        )
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Page content
            TabView(selection: $currentPage) {
                ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                    OnboardingPageView(page: page)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(.easeInOut, value: currentPage)

            // Page indicators and continue button
            VStack(spacing: 24) {
                // Page dots
                HStack(spacing: 8) {
                    ForEach(0..<pages.count, id: \.self) { index in
                        Circle()
                            .fill(index == currentPage ? Color.blue : Color.gray.opacity(0.3))
                            .frame(width: 8, height: 8)
                            .animation(.easeInOut, value: currentPage)
                    }
                }

                // Continue button
                Button {
                    if currentPage < pages.count - 1 {
                        withAnimation {
                            currentPage += 1
                        }
                    } else {
                        showNotificationPrompt = true
                    }
                } label: {
                    HStack {
                        Text(currentPage < pages.count - 1 ? "Continue" : "Get Started")
                            .fontWeight(.semibold)
                        Image(systemName: "arrow.right")
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(
                        LinearGradient(
                            colors: [.blue, .blue.opacity(0.8)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .foregroundColor(.white)
                    .cornerRadius(16)
                }
                .padding(.horizontal, 24)

                // Skip button (only on first pages)
                if currentPage < pages.count - 1 {
                    Button("Skip") {
                        AnalyticsService.shared.logOnboardingSkipped(atPage: currentPage)
                        showNotificationPrompt = true
                    }
                    .foregroundColor(.secondary)
                    .font(.subheadline)
                }
            }
            .padding(.bottom, 40)
        }
        .alert("Allow Meeting Mind to send you notifications?", isPresented: $showNotificationPrompt) {
            Button("Allow") {
                requestNotificationPermission()
                completeOnboarding()
            }
            Button("Don't allow") {
                completeOnboarding()
            }
        } message: {
            Text("Get notified when your recordings are ready to view.")
        }
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
    }

    private func completeOnboarding() {
        AnalyticsService.shared.logOnboardingCompleted()
        withAnimation {
            hasCompletedOnboarding = true
        }
    }
}

// MARK: - Onboarding Page Model

struct OnboardingPage {
    let title: String
    let subtitle: String
    let systemImage: String
    let features: [OnboardingFeature]
    let gradient: [Color]
}

struct OnboardingFeature {
    let icon: String
    let text: String
    let color: Color
}

// MARK: - Onboarding Page View

struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Icon
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: page.gradient,
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 120, height: 120)
                    .shadow(color: page.gradient.first?.opacity(0.4) ?? .clear, radius: 20, y: 10)

                Image(systemName: page.systemImage)
                    .font(.system(size: 50))
                    .foregroundColor(.white)
            }

            // Title
            VStack(spacing: 8) {
                Text(page.title)
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(
                        LinearGradient(
                            colors: page.gradient,
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )

                Text(page.subtitle)
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(.primary)
            }
            .multilineTextAlignment(.center)

            // Features list
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(page.features.enumerated()), id: \.offset) { _, feature in
                    HStack(spacing: 16) {
                        ZStack {
                            Circle()
                                .fill(feature.color.opacity(0.15))
                                .frame(width: 44, height: 44)

                            Image(systemName: feature.icon)
                                .font(.system(size: 18))
                                .foregroundColor(feature.color)
                        }

                        Text(feature.text)
                            .font(.body)
                            .foregroundColor(.primary)

                        Spacer()
                    }
                }
            }
            .padding(.horizontal, 40)
            .padding(.top, 16)

            Spacer()
            Spacer()
        }
        .padding()
    }
}
