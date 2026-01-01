import SwiftUI

// MARK: - Settings View

/// Settings screen with account info, legal links, and consent reminder
struct SettingsView: View {
    @EnvironmentObject var authService: AuthService
    @State private var showSignOutConfirmation = false
    @State private var showDeleteAccountConfirmation = false

    var body: some View {
        NavigationStack {
            List {
                // Account Section
                accountSection

                // Recording Consent Section
                consentSection

                // Legal Section
                legalSection

                // App Info Section
                appInfoSection

                // Sign Out Section
                signOutSection
            }
            .navigationTitle("Settings")
        }
    }

    // MARK: - Account Section

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

    // MARK: - Consent Section

    private var consentSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill")
                        .foregroundColor(.orange)
                    Text("Recording Consent")
                        .font(.headline)
                }

                Text("""
                    **Important:** Before recording any meeting or conversation, ensure you have obtained consent from all participants.

                    Many jurisdictions require consent from one or all parties before recording. You are responsible for complying with applicable laws.

                    Best practices:
                    • Announce at the start that you're recording
                    • Get verbal or written consent
                    • Respect requests to not record
                    • Check your local recording laws
                    """)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding(.vertical, 8)
        } header: {
            Text("Recording Guidelines")
        }
    }

    // MARK: - Legal Section

    private var legalSection: some View {
        Section("Legal") {
            Link(destination: URL(string: "https://summaryai.app/privacy")!) {
                HStack {
                    Label("Privacy Policy", systemImage: "hand.raised")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Link(destination: URL(string: "https://summaryai.app/terms")!) {
                HStack {
                    Label("Terms of Service", systemImage: "doc.text")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            NavigationLink {
                OpenSourceLicensesView()
            } label: {
                Label("Open Source Licenses", systemImage: "chevron.left.forwardslash.chevron.right")
            }
        }
    }

    // MARK: - App Info Section

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

            Link(destination: URL(string: "https://summaryai.app/support")!) {
                HStack {
                    Label("Help & Support", systemImage: "questionmark.circle")
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Link(destination: URL(string: "mailto:support@summaryai.app")!) {
                Label("Contact Us", systemImage: "envelope")
            }
        }
    }

    // MARK: - Sign Out Section

    private var signOutSection: some View {
        Section {
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
                    // TODO: Implement account deletion
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will permanently delete your account and all recordings. This action cannot be undone.")
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
                Text("Summary AI uses the following open source libraries:")
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

// MARK: - Preview

#if DEBUG
struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
            .environmentObject(AuthService())
    }
}
#endif
