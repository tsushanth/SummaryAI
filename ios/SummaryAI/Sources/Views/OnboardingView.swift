import SwiftUI
import PaywallKit

// MARK: - Onboarding View

/// Multi-step onboarding flow for new users
struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool
    @State private var currentPage = 0
    @State private var showEmailCapture = false
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
                        showEmailCapture = true
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
                        showEmailCapture = true
                    }
                    .foregroundColor(.secondary)
                    .font(.subheadline)
                }
            }
            .padding(.bottom, 40)
        }
        .fullScreenCover(isPresented: $showEmailCapture) {
            EmailCaptureView(
                onContinue: {
                    showEmailCapture = false
                    showNotificationPrompt = true
                }
            )
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
        withAnimation {
            hasCompletedOnboarding = true
        }
        UserDefaults.standard.set(true, forKey: "hasCompletedOnboarding")
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

// MARK: - Preview

#if DEBUG
struct OnboardingView_Previews: PreviewProvider {
    static var previews: some View {
        OnboardingView(hasCompletedOnboarding: .constant(false))
    }
}
#endif
