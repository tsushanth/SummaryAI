import SwiftUI

// MARK: - Settings View

/// Settings screen with account info, legal links, and consent reminder
struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @EnvironmentObject var apiClient: SummaryAIAPIClient
    @ObservedObject var calendarViewModel: CalendarViewModel

    @State private var showSignOutConfirmation = false
    @State private var showDeleteAccountConfirmation = false
    @State private var showDeleteError = false
    @State private var deleteErrorMessage = ""
    @State private var showDisconnectConfirmation = false
    @State private var providerToDisconnect: String?
    @State private var showingDataConsent = false
    @ObservedObject private var consentManager = AIDataConsentManager.shared

    var body: some View {
        NavigationStack {
            List {
                // Account Section
                accountSection

                // Integrations Section
                integrationsSection

                // Data & Privacy Section
                dataPrivacySection

                // Legal Section
                legalSection

                // App Info Section
                appInfoSection

                // Sign Out Section
                signOutSection
            }
            .navigationTitle("Settings")
            .alert("Error", isPresented: $showDeleteError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(deleteErrorMessage)
            }
        }
    }

    // MARK: - Account Section

    @ViewBuilder
    private var accountSection: some View {
        Section("Account") {
            if let user = authService.state.user {
                HStack(spacing: 12) {
                    // Avatar
                    ZStack {
                        Circle()
                            .fill(Color.blue.opacity(0.2))
                            .frame(width: 50, height: 50)

                        Text(user.email.prefix(1).uppercased())
                            .font(.title2)
                            .fontWeight(.semibold)
                            .foregroundColor(.blue)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        if let name = user.fullName, !name.isEmpty {
                            Text(name)
                                .font(.headline)
                        }

                        Text(user.email)
                            .font(.subheadline)
                            .foregroundColor(.secondary)

                        HStack(spacing: 4) {
                            Image(systemName: providerIcon(user.provider))
                                .font(.caption)
                            Text("via \(providerName(user.provider))")
                                .font(.caption)
                        }
                        .foregroundColor(.secondary)
                    }
                }
                .padding(.vertical, 4)
            } else {
                Text("Not signed in")
                    .foregroundColor(.secondary)
            }
        }
    }

    private func providerIcon(_ provider: AuthProvider) -> String {
        switch provider {
        case .apple: return "apple.logo"
        case .google: return "globe"
        case .email: return "envelope"
        }
    }

    private func providerName(_ provider: AuthProvider) -> String {
        switch provider {
        case .apple: return "Apple"
        case .google: return "Google"
        case .email: return "Email"
        }
    }

    // MARK: - Data & Privacy Section

    @ViewBuilder
    private var dataPrivacySection: some View {
        Section {
            Button {
                showingDataConsent = true
            } label: {
                HStack {
                    Label("AI Data Sharing", systemImage: "shield.checkered")
                    Spacer()
                    Text(consentManager.hasConsented ? "Allowed" : "Not Allowed")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .foregroundColor(.primary)
        } header: {
            Text("Data & Privacy")
        } footer: {
            Text(consentManager.hasConsented
                 ? "Your recordings are processed by cloud AI services for transcription and summarization."
                 : "AI-powered features are disabled. Grant consent to enable transcription, summaries, and more.")
        }
        .sheet(isPresented: $showingDataConsent) {
            AIDataConsentView(isOnboarding: false)
        }
    }

    // MARK: - Legal Section

    @ViewBuilder
    private var legalSection: some View {
        Section("Legal") {
            Link(destination: URL(string: "https://kreativekoala.llc/privacy")!) {
                HStack {
                    Label("Privacy Policy", systemImage: "hand.raised")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Link(destination: URL(string: "https://kreativekoala.llc/terms")!) {
                HStack {
                    Label("Terms of Service", systemImage: "doc.text")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    // MARK: - Integrations Section

    @ViewBuilder
    private var integrationsSection: some View {
        Section("Integrations") {
            // Show connected calendars if any
            if calendarViewModel.hasConnectedCalendars {
                // Google Calendar
                if let google = calendarViewModel.googleConnection {
                    HStack {
                        Image(systemName: "calendar")
                            .foregroundColor(.red)
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Google Calendar")
                                .font(.body)
                            Text(google.providerEmail ?? "Connected")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Button("Disconnect") {
                            providerToDisconnect = "google"
                            showDisconnectConfirmation = true
                        }
                        .font(.caption)
                        .foregroundColor(.red)
                    }
                }

                // Microsoft Outlook
                if let outlook = calendarViewModel.outlookConnection {
                    HStack {
                        Image(systemName: "envelope.fill")
                            .foregroundColor(Color(red: 0, green: 0.47, blue: 0.95))
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Microsoft Outlook")
                                .font(.body)
                            Text(outlook.providerEmail ?? "Connected")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }

                        Spacer()

                        Button("Disconnect") {
                            providerToDisconnect = "microsoft"
                            showDisconnectConfirmation = true
                        }
                        .font(.caption)
                        .foregroundColor(.red)
                    }
                }

                // Add another calendar
                NavigationLink {
                    CalendarIntegrationView(viewModel: calendarViewModel)
                        .navigationTitle("Add Calendar")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    Label("Add Another Calendar", systemImage: "plus.circle")
                        .foregroundColor(.blue)
                }
            } else {
                // No calendars connected - show link to connect
                NavigationLink {
                    CalendarIntegrationView(viewModel: calendarViewModel)
                        .navigationTitle("Calendar Integration")
                        .navigationBarTitleDisplayMode(.inline)
                } label: {
                    Label("Connect Calendar", systemImage: "calendar.badge.plus")
                }
            }
        }
        .confirmationDialog(
            "Disconnect Calendar",
            isPresented: $showDisconnectConfirmation,
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                if let provider = providerToDisconnect {
                    Task {
                        await calendarViewModel.disconnect(provider: provider)
                    }
                }
            }
            Button("Cancel", role: .cancel) {
                providerToDisconnect = nil
            }
        } message: {
            Text("This will stop syncing meetings from this calendar. You can reconnect anytime.")
        }
    }

    // MARK: - App Info Section

    @ViewBuilder
    private var appInfoSection: some View {
        Section("About") {
            HStack {
                Text("Version")
                Spacer()
                Text(appVersion)
                    .foregroundColor(.secondary)
            }

            HStack {
                Text("Build")
                Spacer()
                Text(buildNumber)
                    .foregroundColor(.secondary)
            }

            NavigationLink {
                FAQView()
            } label: {
                Label("Help & FAQ", systemImage: "questionmark.circle")
            }

            Link(destination: URL(string: "https://kreativekoala.llc/contact")!) {
                HStack {
                    Label("Contact Us", systemImage: "envelope")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    // MARK: - Sign Out Section

    private var signOutSection: some View {
        Section {
            signOutButton
            deleteAccountButton
        }
    }

    private var signOutButton: some View {
        Button(role: .destructive) {
            showSignOutConfirmation = true
        } label: {
            HStack {
                Spacer()
                Text("Sign Out")
                Spacer()
            }
        }
        .confirmationDialog("Sign Out", isPresented: $showSignOutConfirmation) {
            Button("Sign Out", role: .destructive) {
                Task { await authService.signOut() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to sign out?")
        }
    }

    private var deleteAccountButton: some View {
        Button(role: .destructive) {
            showDeleteAccountConfirmation = true
        } label: {
            HStack {
                Spacer()
                Text("Delete Account")
                    .foregroundColor(.red.opacity(0.8))
                Spacer()
            }
        }
        .confirmationDialog("Delete Account", isPresented: $showDeleteAccountConfirmation) {
            Button("Delete Account", role: .destructive) {
                performDeleteAccount()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently delete your account and all recordings. This action cannot be undone.")
        }
    }

    private func performDeleteAccount() {
        Task {
            do {
                // Delete account via backend API
                try await apiClient.deleteAccount()
                // Sign out locally after successful deletion
                await authService.signOut()
            } catch {
                deleteErrorMessage = error.localizedDescription
                showDeleteError = true
            }
        }
    }

    // MARK: - Helpers

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
    }
}

// MARK: - Open Source Licenses View

struct OpenSourceLicensesView: View {
    var body: some View {
        List {
            Section {
                Text("Meeting Mind uses the following open source libraries:")
                    .foregroundColor(.secondary)
            }

            // Add actual libraries used
            LicenseRow(
                name: "Swift",
                license: "Apache 2.0",
                url: "https://swift.org"
            )

            LicenseRow(
                name: "Supabase Swift",
                license: "MIT",
                url: "https://github.com/supabase/supabase-swift"
            )
        }
        .navigationTitle("Open Source Licenses")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct LicenseRow: View {
    let name: String
    let license: String
    let url: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(name)
                .font(.headline)

            Text(license)
                .font(.caption)
                .foregroundColor(.secondary)

            if let url = URL(string: url) {
                Link(url.host ?? url.absoluteString, destination: url)
                    .font(.caption)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Storage Usage View (Optional)

struct StorageUsageView: View {
    @State private var recordingsCount: Int = 0
    @State private var totalSize: Int64 = 0
    @State private var isLoading = true

    var body: some View {
        List {
            Section {
                HStack {
                    Text("Recordings")
                    Spacer()
                    if isLoading {
                        ProgressView()
                    } else {
                        Text("\(recordingsCount)")
                            .foregroundColor(.secondary)
                    }
                }

                HStack {
                    Text("Storage Used")
                    Spacer()
                    if isLoading {
                        ProgressView()
                    } else {
                        Text(formatBytes(totalSize))
                            .foregroundColor(.secondary)
                    }
                }
            }

            Section {
                Button(role: .destructive) {
                    // TODO: Implement clear cache
                } label: {
                    Text("Clear Local Cache")
                }
            } footer: {
                Text("Clearing the cache will remove downloaded transcripts and summaries. They will be re-downloaded when you view them.")
            }
        }
        .navigationTitle("Storage")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadStorageInfo()
        }
    }

    private func loadStorageInfo() async {
        // TODO: Implement actual storage calculation
        isLoading = false
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}

// MARK: - FAQ View

/// Help and FAQ section with expandable questions
struct FAQView: View {
    @State private var expandedQuestions: Set<String> = []

    private let faqItems: [FAQItem] = [
        FAQItem(
            question: "How does Meeting Mind work?",
            answer: "Meeting Mind uses advanced speech recognition and AI to transcribe your recordings and generate intelligent summaries. Simply record your meeting or conversation, and our system will automatically transcribe the audio, identify speakers, and create a concise summary with key points and action items."
        ),
        FAQItem(
            question: "Is there a limit on recording time?",
            answer: "Free users can record up to 10 minutes per recording. Pro users enjoy unlimited recording time with no restrictions on file size or duration."
        ),
        FAQItem(
            question: "Are my recordings private?",
            answer: "Yes. Your recordings are encrypted and stored securely. To provide transcription and summarization, your audio and text are processed by third-party AI services (Deepgram for transcription, OpenAI for summaries). These services do not use your data for model training. You control this sharing via Settings > Data & Privacy."
        ),
        FAQItem(
            question: "How accurate are the transcriptions?",
            answer: "Our transcription accuracy is typically above 95% for clear audio in supported languages. Accuracy may vary based on audio quality, background noise, accents, and technical terminology. You can always edit transcripts to correct any errors."
        ),
        FAQItem(
            question: "Can I use it to record online meetings?",
            answer: "Yes! You can use Meeting Mind to record audio from any source, including online meetings on Zoom, Google Meet, Teams, and other platforms. Simply start a recording while in your meeting. Note: Always ensure you have permission from all participants before recording."
        ),
        FAQItem(
            question: "Can I use Meeting Mind while using other apps or with my screen off?",
            answer: "Yes, Meeting Mind supports background recording. You can start a recording and then switch to other apps or turn off your screen - the recording will continue. A status bar indicator will show that recording is in progress."
        ),
        FAQItem(
            question: "Can I access Meeting Mind on multiple devices?",
            answer: "Yes, your Meeting Mind account syncs across all your devices. Sign in with the same account on any iOS device to access all your recordings, transcripts, and summaries."
        ),
        FAQItem(
            question: "Can I record multiple languages?",
            answer: "Yes, Meeting Mind supports over 120 languages for transcription. You can select the language before recording, or use auto-detect to let our system identify the language automatically."
        )
    ]

    var body: some View {
        List {
            Section {
                Text("Common Questions or problems")
                    .font(.title2)
                    .fontWeight(.bold)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 16, leading: 0, bottom: 16, trailing: 0))
            }

            ForEach(faqItems) { item in
                FAQItemView(
                    item: item,
                    isExpanded: expandedQuestions.contains(item.id)
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        if expandedQuestions.contains(item.id) {
                            expandedQuestions.remove(item.id)
                        } else {
                            expandedQuestions.insert(item.id)
                        }
                    }
                }
            }

            // Contact section
            Section {
                VStack(spacing: 16) {
                    Text("Having issues with your subscription?")
                        .font(.subheadline)
                        .foregroundColor(.secondary)

                    Button {
                        if let url = URL(string: "https://kreativekoala.llc/contact") {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("Contact Us")
                            .font(.subheadline)
                            .foregroundColor(.blue)
                    }

                    Button {
                        // Restore purchases
                    } label: {
                        Text("Restore Purchase")
                            .font(.subheadline)
                            .foregroundColor(.blue)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 24)
            }
            .listRowBackground(Color.clear)
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Help & FAQ")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - FAQ Item Model

struct FAQItem: Identifiable {
    let id = UUID().uuidString
    let question: String
    let answer: String
}

// MARK: - FAQ Item View

struct FAQItemView: View {
    let item: FAQItem
    let isExpanded: Bool
    let onTap: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: onTap) {
                HStack {
                    Text(item.question)
                        .font(.body)
                        .foregroundColor(.primary)
                        .multilineTextAlignment(.leading)

                    Spacer()

                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 16)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Text(item.answer)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.bottom, 16)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}


// MARK: - Preview

#if DEBUG
struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        let apiClient = SummaryAIAPIClient()
        SettingsView(calendarViewModel: CalendarViewModel(apiClient: apiClient))
            .environmentObject(AuthService())
            .environmentObject(apiClient)
    }
}
#endif
